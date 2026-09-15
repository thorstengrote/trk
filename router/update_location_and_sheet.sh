#!/bin/sh

# Zugangsdaten kommen aus /etc/vanbox/secrets.env, siehe docs/ROUTER.md
[ -f /etc/vanbox/secrets.env ] && . /etc/vanbox/secrets.env
. /etc/vanbox/lib.sh
VB_TAG=tracking

# Kein "set -e". Es hat das Script beim ersten Schluckauf still beendet und die
# Fehlerbehandlung weiter unten zu totem Code gemacht.

# Configuration
CREDENTIALS_JSON="${CREDENTIALS_JSON:-/etc/vanbox/google-sa.json}"
# Zustand liegt auf dem USB-Stick, nicht im tmpfs. Er ueberlebt damit den
# Kippschalter im Van.
TOKEN_FILE=$(vb_state google_access_token)
LAST_ENTRY_FILE=$(vb_state last_google_sheet_entry)
LAST_CELL_INFO_FILE=$(vb_state last_cell_info)
LAST_NOTIFICATION_FILE=$(vb_state last_telegram_notification)
SPREADSHEET_ID="${SPREADSHEET_ID:?fehlt in /etc/vanbox/secrets.env}"
RANGE_NAME='Tabellenblatt1!A:F'
# Hoechstens so viele Unwired-Abfragen pro Tag. Der freie Tarif hat ein
# Tages- und ein Monatslimit, und bis heute hat das Script es blind leergefahren.
UNWIRED_DAILY_MAX="${UNWIRED_DAILY_MAX:-60}"
# So lange wird eine Zelle, die kein Ergebnis hatte, nicht erneut abgefragt.
UNWIRED_DENY_TTL="${UNWIRED_DENY_TTL:-604800}"
# Hoechstens so viele gepufferte Punkte pro Lauf nachreichen.
OFFLINE_BATCH_MAX="${OFFLINE_BATCH_MAX:-8}"
UNWIRED_API_KEY="${UNWIRED_API_KEY:?fehlt in /etc/vanbox/secrets.env}"
UNWIRED_URL="https://us1.unwiredlabs.com/v2/process.php"
OPEN_ELEVATION_URL="https://api.open-elevation.com/api/v1/lookup"
BOT_TOKEN="${BOT_TOKEN:?fehlt in /etc/vanbox/secrets.env}"
CHAT_ID="${CHAT_ID:?fehlt in /etc/vanbox/secrets.env}"
VERBOSE=false
OFFLINE_DATA_DIR=$(vb_state offline_location_data)

# Create offline data directory if it doesn't exist
mkdir -p "$OFFLINE_DATA_DIR"

# Function for verbose output
log_verbose() {
    if $VERBOSE; then
        echo "[VERBOSE] $1"
    fi
}

# Function to convert hexadecimal to decimal
hex_to_dec() {
    if [ "$1" != "" ] && [ "$1" != "-" ]; then
        printf '%d\n' "0x$1"
    else
        echo "0"
    fi
}

# Function to send Telegram messages
send_telegram_message() {
    # Geht ueber vb_notify: mit Timeout, und ein Fehlschlag landet in der
    # Warteschlange auf dem Stick statt im Nichts.
    vb_notify "$1"
}

# Function to generate a new token
generate_token() {
    log_verbose "Generating new token"
    CLIENT_EMAIL=$(jq -r .client_email $CREDENTIALS_JSON)
    PRIVATE_KEY=$(jq -r .private_key $CREDENTIALS_JSON | sed 's/\\n/\n/g')
    PRIVATE_KEY_FILE=$(mktemp)
    echo "$PRIVATE_KEY" > "$PRIVATE_KEY_FILE"

    HEADER=$(echo -n '{"alg":"RS256","typ":"JWT"}' | openssl base64 -e | tr -d '=' | tr '/+' '_-' | tr -d '\n')
    NOW=$(date +%s)
    EXP=$(($NOW + 3600))
    PAYLOAD=$(echo -n "{\"iss\":\"$CLIENT_EMAIL\",\"scope\":\"https://www.googleapis.com/auth/spreadsheets\",\"aud\":\"https://oauth2.googleapis.com/token\",\"exp\":$EXP,\"iat\":$NOW}" | openssl base64 -e | tr -d '=' | tr '/+' '_-' | tr -d '\n')
    SIGNATURE=$(echo -n "$HEADER.$PAYLOAD" | openssl dgst -sha256 -sign "$PRIVATE_KEY_FILE" | openssl base64 -e | tr -d '=' | tr '/+' '_-' | tr -d '\n')
    JWT="$HEADER.$PAYLOAD.$SIGNATURE"

    RESPONSE=$(vb_curl -X POST -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=$JWT" \
        https://oauth2.googleapis.com/token)
    ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r .access_token 2>/dev/null)
    rm -f "$PRIVATE_KEY_FILE"

    if [ "$ACCESS_TOKEN" = "null" ] || [ -z "$ACCESS_TOKEN" ]; then
        # Kein exit: ohne Token kann nichts geschrieben werden, gepuffert
        # werden kann trotzdem.
        vb_log ERROR "Google-Token nicht erhalten"
        return 1
    fi

    echo "$ACCESS_TOKEN" > "$TOKEN_FILE"
    log_verbose "New token generated and saved"
    return 0
}

# Check and refresh token if necessary
check_and_refresh_token() {
    log_verbose "Checking token"
    if [ ! -f "$TOKEN_FILE" ]; then
        generate_token
    else
        TOKEN_AGE=$(($(date +%s) - $(date +%s -r "$TOKEN_FILE")))
        if [ "$TOKEN_AGE" -ge 3500 ]; then
            generate_token
        else
            log_verbose "Existing token is still valid"
        fi
    fi
}

# Function to extract network information
get_network_info() {
    QUERY_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    CELL_INFO=$(gl_modem AT 'AT+QENG="servingcell"' | tr -d '\r' | tr -d '\n')
    log_verbose "Received cell information at $QUERY_TIME: $CELL_INFO"
    if [ -z "$CELL_INFO" ]; then
        vb_log WARN "Modem liefert keine Zellinformation"
        return 1
    fi
    # RSRP steht bei LTE an Position 14 und sagt, wie gut der Empfang war.
    RSRP=$(echo "$CELL_INFO" | awk -F',' '{print $14}' | tr -d ' ')
    case "$RSRP" in ''|*[!0-9-]*) RSRP="" ;; esac

    # Extract network type
    NETWORK_TYPE=$(echo "$CELL_INFO" | awk -F',' '{print $3}' | tr -d '"')
    
    # Extract common information
    MCC=$(echo "$CELL_INFO" | awk -F',' '{print $5}' | tr -d ' ')
    MNC=$(echo "$CELL_INFO" | awk -F',' '{print $6}' | tr -d ' ')

    case $NETWORK_TYPE in
        "GSM")
            LAC=$(echo "$CELL_INFO" | awk -F',' '{print $8}' | tr -d ' ')
            CID=$(echo "$CELL_INFO" | awk -F',' '{print $7}' | tr -d ' ')
            ;;
        "WCDMA")
            LAC=$(echo "$CELL_INFO" | awk -F',' '{print $8}' | tr -d ' ')
            CID=$(echo "$CELL_INFO" | awk -F',' '{print $7}' | tr -d ' ')
            ;;
        "LTE")
            TAC=$(echo "$CELL_INFO" | awk -F',' '{print $8}' | tr -d ' ')
            ECI=$(echo "$CELL_INFO" | awk -F',' '{print $7}' | tr -d ' ')
            ;;
        *)
            log_verbose "Unknown network type: $NETWORK_TYPE"
            return 1
            ;;
    esac
}

# Function to create complete cell identifier for comparison
create_cell_identifier() {
    case $NETWORK_TYPE in
        "GSM"|"WCDMA")
            CURRENT_CELL_INFO="$NETWORK_TYPE,$MCC,$MNC,$LAC,$CID"
            ;;
        "LTE")
            CURRENT_CELL_INFO="$NETWORK_TYPE,$MCC,$MNC,$TAC,$ECI"
            ;;
        *)
            CURRENT_CELL_INFO="$NETWORK_TYPE,$MCC,$MNC"
            log_verbose "Warning: Unknown network type, using basic identifier"
            ;;
    esac
    log_verbose "Current cell identifier: $CURRENT_CELL_INFO"
}

# Function to create Unwired Labs JSON payload
create_unwired_payload() {
    case $NETWORK_TYPE in
        "GSM")
            JSON_PAYLOAD=$(cat <<EOF
{
  "token": "$UNWIRED_API_KEY",
  "radio": "gsm",
  "mcc": $MCC,
  "mnc": $MNC,
  "cells": [
    {
      "lac": $(hex_to_dec $LAC),
      "cid": $(hex_to_dec $CID)
    }
  ],
  "address": 1,
  "query_time": "$QUERY_TIME",
  "cell_key": "$CURRENT_CELL_INFO",
  "rsrp": "$RSRP"
}
EOF
            )
            ;;
        "WCDMA")
            JSON_PAYLOAD=$(cat <<EOF
{
  "token": "$UNWIRED_API_KEY",
  "radio": "umts",
  "mcc": $MCC,
  "mnc": $MNC,
  "cells": [
    {
      "lac": $(hex_to_dec $LAC),
      "cid": $(hex_to_dec $CID)
    }
  ],
  "address": 1,
  "query_time": "$QUERY_TIME",
  "cell_key": "$CURRENT_CELL_INFO",
  "rsrp": "$RSRP"
}
EOF
            )
            ;;
        "LTE")
            JSON_PAYLOAD=$(cat <<EOF
{
  "token": "$UNWIRED_API_KEY",
  "radio": "lte",
  "mcc": $MCC,
  "mnc": $MNC,
  "cells": [
    {
      "tac": $(hex_to_dec $TAC),
      "cid": $(hex_to_dec $ECI)
    }
  ],
  "address": 1,
  "query_time": "$QUERY_TIME",
  "cell_key": "$CURRENT_CELL_INFO",
  "rsrp": "$RSRP"
}
EOF
            )
            ;;
        *)
            log_verbose "Unknown network type for Unwired Labs Payload: $NETWORK_TYPE"
            return 1
            ;;
    esac
}

# Function to save offline data
save_offline_data() {
    TIMESTAMP=$(date +%s)
    FILENAME="${OFFLINE_DATA_DIR}/offline_data_${TIMESTAMP}.json"
    echo "$JSON_PAYLOAD" > "$FILENAME"
    log_verbose "Offline data saved to $FILENAME"
}

# Function to process offline data
process_offline_data() {
    # Frueher lief hier bei jedem Cronlauf der komplette Puffer durch, und jeder
    # Eintrag kostete eine Unwired-Abfrage. Ein voller Puffer hat so das
    # Tageskontingent in einem einzigen Lauf aufgebraucht. Jetzt: aeltester
    # zuerst, gedeckelt, und beim ersten Fehlschlag Schluss.
    OFFLINE_DONE=0
    for FILE in $(ls "$OFFLINE_DATA_DIR" 2>/dev/null | sort | head -n "$OFFLINE_BATCH_MAX"); do
        FILE="$OFFLINE_DATA_DIR/$FILE"
        [ -f "$FILE" ] || continue
        if ! vb_budget_ok unwired "$UNWIRED_DAILY_MAX"; then
            vb_log INFO "Tagesbudget erschoepft, Puffer bleibt liegen"
            break
        fi
        log_verbose "Processing offline data from $FILE"
        JSON_PAYLOAD=$(cat "$FILE")
        if process_location_data; then
            rm -f "$FILE"
            OFFLINE_DONE=$((OFFLINE_DONE + 1))
        else
            vb_log WARN "Nachreichen fehlgeschlagen, Rest bleibt gepuffert"
            break
        fi
    done
    REST=$(ls "$OFFLINE_DATA_DIR" 2>/dev/null | wc -l)
    [ "$OFFLINE_DONE" -gt 0 ] && vb_log INFO "$OFFLINE_DONE gepufferte Punkte nachgereicht, $REST offen"
    return 0
}

# Function to get elevation data
get_elevation() {
    local LAT=$1
    local LON=$2
    local ELEVATION_RESPONSE=$(vb_curl -X POST -H "Content-Type: application/json" -d "{\"locations\":[{\"latitude\":$LAT,\"longitude\":$LON}]}" "$OPEN_ELEVATION_URL")
    if echo "$ELEVATION_RESPONSE" | jq -e '.results[0].elevation' > /dev/null; then
        ELEVATION=$(echo $ELEVATION_RESPONSE | jq -r '.results[0].elevation')
        log_verbose "Elevation for LAT=$LAT, LON=$LON: $ELEVATION meters"
    else
        ELEVATION="N/A"
        log_verbose "Failed to get elevation for LAT=$LAT, LON=$LON. Using N/A."
    fi
}

# Function to process location data
process_location_data() {
    log_verbose "Processing location data"

    # Zelle dieses Datensatzes, fuer Sperrliste und Protokoll
    CELL_KEY=$(echo "$JSON_PAYLOAD" | jq -r '"\(.mcc),\(.mnc),\(.cells[0].lac),\(.cells[0].cid)"' 2>/dev/null)

    if vb_deny_has zellen "$CELL_KEY" "$UNWIRED_DENY_TTL"; then
        vb_log INFO "Zelle $CELL_KEY steht auf der Sperrliste, keine Abfrage"
        return 1
    fi
    if ! vb_budget_ok unwired "$UNWIRED_DAILY_MAX"; then
        vb_log INFO "Tagesbudget Unwired erschoepft ($(vb_budget_used unwired)/$UNWIRED_DAILY_MAX)"
        return 1
    fi

    RESPONSE=$(vb_curl -X POST -H "Content-Type: application/json" -d "$JSON_PAYLOAD" "$UNWIRED_URL")
    UNWIRED_RC=$?
    vb_budget_use unwired
    log_verbose "Response from Unwired Labs: $RESPONSE"

    BALANCE=$(echo "$RESPONSE" | jq -r '.balance // empty' 2>/dev/null)
    [ -n "$BALANCE" ] && [ "$BALANCE" -lt 20 ] 2>/dev/null && \
        vb_log WARN "Unwired-Restkontingent nur noch $BALANCE"

    if [ "$UNWIRED_RC" -ne 0 ] || echo "$RESPONSE" | jq -e '.status == "error"' > /dev/null 2>&1; then
        ERROR_MESSAGE=$(echo "$RESPONSE" | jq -r '.message // "keine Antwort"' 2>/dev/null)
        vb_log WARN "Ortung fehlgeschlagen fuer $CELL_KEY: $ERROR_MESSAGE"
        # Eine Zelle, die der Anbieter nicht kennt, kennt er auch in 15 Minuten
        # nicht. Ohne diese Sperre lief genau daraus eine Endlosschleife.
        case "$ERROR_MESSAGE" in
            *"No matches found"*|*"not found"*) vb_deny_add zellen "$CELL_KEY" ;;
        esac
        return 1
    fi

    LAT=$(echo $RESPONSE | jq -r '.lat')
    LON=$(echo $RESPONSE | jq -r '.lon')
    
    log_verbose "Received position: LAT=$LAT, LON=$LON"

    # Get elevation data DIRECTLY for new entry
    get_elevation $LAT $LON

    # Extract the original query time from the JSON payload
    ORIGINAL_TIME=$(echo $JSON_PAYLOAD | jq -r '.query_time')
    log_verbose "Original query time: $ORIGINAL_TIME"

    check_and_refresh_token
    ACCESS_TOKEN=$(cat "$TOKEN_FILE")

    # Zwei zusaetzliche Spalten: welche Zelle den Punkt geliefert hat und wie
    # gut der Empfang war. Ohne das laesst sich hinterher nicht unterscheiden,
    # ob die Karte springt oder der Van gefahren ist.
    ROW_CELL=$(echo "$JSON_PAYLOAD" | jq -r '.cell_key // empty' 2>/dev/null)
    [ -n "$ROW_CELL" ] || ROW_CELL="$CELL_KEY"
    ROW_RSRP=$(echo "$JSON_PAYLOAD" | jq -r '.rsrp // empty' 2>/dev/null)
    DATA="{\"values\":[[\"$LAT\",\"$LON\",\"$ORIGINAL_TIME\",\"$ELEVATION\",\"$ROW_CELL\",\"$ROW_RSRP\"]]}"

    log_verbose "Sending data to Google Sheets (LAT=$LAT, LON=$LON, ELEVATION=$ELEVATION)"
    RESPONSE=$(vb_curl -X POST \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$DATA" \
        "https://sheets.googleapis.com/v4/spreadsheets/$SPREADSHEET_ID/values/$RANGE_NAME:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS")

    if echo "$RESPONSE" | jq -e .updates > /dev/null 2>&1; then
        vb_log INFO "Punkt geschrieben: $LAT,$LON ($ROW_CELL, RSRP $ROW_RSRP, Hoehe $ELEVATION)"
        echo "$LAT,$LON,$ELEVATION" > "$LAST_ENTRY_FILE"
        echo "$CURRENT_CELL_INFO" > "$LAST_CELL_INFO_FILE"
        return 0
    else
        vb_log WARN "Google Sheets hat den Punkt nicht angenommen"
        log_verbose "Full response from Google Sheets: $RESPONSE"
        return 1
    fi
}

# Function to update existing records with missing elevation data
update_missing_elevations() {
    log_verbose "Checking for records with missing elevation data"
    check_and_refresh_token
    ACCESS_TOKEN=$(cat "$TOKEN_FILE")
    # Get all data from the sheet
    RESPONSE=$(vb_curl -H "Authorization: Bearer $ACCESS_TOKEN" \
        "https://sheets.googleapis.com/v4/spreadsheets/$SPREADSHEET_ID/values/$RANGE_NAME")
    
    # Check if we got a valid response
    if ! echo "$RESPONSE" | jq -e '.values' > /dev/null; then
        log_verbose "Failed to retrieve data from Google Sheets"
        return 1
    fi

    # Process each row
    ROW=1
    echo "$RESPONSE" | jq -r '.values[] | @csv' | while IFS=',' read -r LAT LON TIME ELEVATION; do
        # Skip the header row
        if [ $ROW -eq 1 ]; then
            ROW=$((ROW + 1))
            continue
        fi

        # Remove any quotation marks
        LAT=$(echo "$LAT" | tr -d '"')
        LON=$(echo "$LON" | tr -d '"')
        TIME=$(echo "$TIME" | tr -d '"')
        ELEVATION=$(echo "$ELEVATION" | tr -d '"')

        # Check if LAT and LON are valid numbers
        if [[ $LAT =~ ^[-+]?[0-9]*\.?[0-9]+$ ]] && [[ $LON =~ ^[-+]?[0-9]*\.?[0-9]+$ ]]; then
            # If elevation is empty or doesn't exist, update it
            if [ -z "$ELEVATION" ] || [ "$ELEVATION" = "null" ] || [ "$ELEVATION" = "N/A" ]; then
                log_verbose "Updating elevation for row $ROW"
                get_elevation "$LAT" "$LON"
                
                UPDATE_RANGE="Tabellenblatt1!D$ROW"
                UPDATE_DATA="{\"values\":[[\"$ELEVATION\"]]}"
                
                UPDATE_RESPONSE=$(vb_curl -X PUT \
                    -H "Authorization: Bearer $ACCESS_TOKEN" \
                    -H "Content-Type: application/json" \
                    -d "$UPDATE_DATA" \
                    "https://sheets.googleapis.com/v4/spreadsheets/$SPREADSHEET_ID/values/$UPDATE_RANGE?valueInputOption=USER_ENTERED")
                
                if echo "$UPDATE_RESPONSE" | jq -e .updatedCells > /dev/null; then
                    log_verbose "Updated elevation for row $ROW"
                else
                    log_verbose "Failed to update elevation for row $ROW"
                fi

                # Add a small delay to avoid rate limiting
                sleep 1
            else
                log_verbose "Elevation already exists for row $ROW. Skipping."
            fi
        else
            log_verbose "Invalid latitude or longitude in row $ROW. Skipping."
        fi
        
        ROW=$((ROW + 1))
    done
}

# Function to show help
show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  --verbose            Enable verbose output mode"
    echo "  --help               Display this help message"
    echo "  --debug-cell         Show current cell info and exit (debug mode)"
    echo "  --fix-elevations     One-time fix: Update missing elevations in existing data"
    echo
    echo "Example:"
    echo "  $0 --verbose"
    echo "  $0 --debug-cell      # Debug: Show current cell information"
    echo "  $0 --fix-elevations  # One-time: Fix missing elevations in old data"
}

# Debug function to show current cell info
debug_cell_info() {
    echo "=== DEBUG: Current Cell Information ==="
    get_network_info
    if [ $? -eq 0 ]; then
        create_cell_identifier
        echo "Network Type: $NETWORK_TYPE"
        echo "MCC: $MCC"
        echo "MNC: $MNC"
        case $NETWORK_TYPE in
            "GSM"|"WCDMA")
                echo "LAC: $LAC (decimal: $(hex_to_dec $LAC))"
                echo "CID: $CID (decimal: $(hex_to_dec $CID))"
                ;;
            "LTE")
                echo "TAC: $TAC (decimal: $(hex_to_dec $TAC))"
                echo "ECI: $ECI (decimal: $(hex_to_dec $ECI))"
                ;;
        esac
        echo "Complete Cell Identifier: $CURRENT_CELL_INFO"
        
        if [ -f "$LAST_CELL_INFO_FILE" ]; then
            LAST_CELL_INFO=$(cat "$LAST_CELL_INFO_FILE")
            echo "Last Cell Identifier: $LAST_CELL_INFO"
            if [ "$CURRENT_CELL_INFO" = "$LAST_CELL_INFO" ]; then
                echo "Status: SAME CELL (no update would be triggered)"
            else
                echo "Status: DIFFERENT CELL (update would be triggered)"
            fi
        else
            echo "Status: NO PREVIOUS CELL INFO (first run, update would be triggered)"
        fi
    else
        echo "ERROR: Failed to get network information"
        exit 1
    fi
    echo "======================================="
}

# Main function
main() {
    # Process command line arguments
    while [ "$1" != "" ]; do
        case $1 in
            --verbose )  VERBOSE=true
                         ;;
            --help )     show_help
                         exit 0
                         ;;
            --debug-cell )  debug_cell_info
                           exit 0
                           ;;
            --fix-elevations )  update_missing_elevations
                               exit 0
                               ;;
            * )          echo "Unknown parameter: $1"
                         show_help
                         exit 1
        esac
        shift
    done

    if ! get_network_info; then
        vb_log WARN "Keine Netzinformation vom Modem, Lauf beendet"
        exit 1
    fi

    # Create complete cell identifier for comparison
    create_cell_identifier

    # Check if cell info has changed (now with complete cell information)
    if [ -f "$LAST_CELL_INFO_FILE" ]; then
        LAST_CELL_INFO=$(cat "$LAST_CELL_INFO_FILE")
        if [ "$CURRENT_CELL_INFO" = "$LAST_CELL_INFO" ]; then
            log_verbose "Cell information unchanged. Current: $CURRENT_CELL_INFO. Exiting."
            exit 0
        else
            log_verbose "Cell changed from [$LAST_CELL_INFO] to [$CURRENT_CELL_INFO]"
        fi
    else
        log_verbose "No previous cell info found. First run with current cell: $CURRENT_CELL_INFO"
    fi

    if ! create_unwired_payload; then
        vb_log ERROR "Nutzlast fuer die Ortung konnte nicht gebaut werden"
        exit 1
    fi

    # Gepufferte Punkte zuerst, gedeckelt
    process_offline_data

    if process_location_data; then
        log_verbose "Current location data processed successfully"
    else
        log_verbose "Failed to process current location data. Saving offline."
        save_offline_data
    fi

    # Der Bezeichner wird jetzt in jedem Fall fortgeschrieben, auch nach einem
    # Fehlschlag. Vorher stand er nur im Erfolgsfall drin, wodurch dieselbe
    # Zelle alle 15 Minuten erneut abgefragt wurde, bis das Kontingent leer war.
    echo "$CURRENT_CELL_INFO" > "$LAST_CELL_INFO_FILE"

    # Haengengebliebene Telegram-Nachrichten nachreichen
    vb_notify_flush

    # REMOVED: update_missing_elevations() 
    # Elevation is now fetched directly in process_location_data()
    # No need to read entire Google Sheet every time
}

# Main program logic
case "$1" in
    --help)
        show_help
        ;;
    --debug-cell)
        debug_cell_info
        ;;
    --fix-elevations)
        update_missing_elevations
        ;;
    *)
        main "$@"
        ;;
esac
