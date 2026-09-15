#!/bin/sh

# Zugangsdaten kommen aus /etc/vanbox/secrets.env, siehe docs/ROUTER.md
[ -f /etc/vanbox/secrets.env ] && . /etc/vanbox/secrets.env
set -e

# Configuration
CREDENTIALS_JSON="${CREDENTIALS_JSON:-/etc/vanbox/google-sa.json}"
TOKEN_FILE='/tmp/google_access_token'
LAST_ENTRY_FILE='/tmp/last_google_sheet_entry'
LAST_CELL_INFO_FILE='/tmp/last_cell_info'
LAST_NOTIFICATION_FILE='/tmp/last_telegram_notification'
SPREADSHEET_ID="${SPREADSHEET_ID:?fehlt in /etc/vanbox/secrets.env}"
RANGE_NAME='Tabellenblatt1!A:D'
UNWIRED_API_KEY="${UNWIRED_API_KEY:?fehlt in /etc/vanbox/secrets.env}"
UNWIRED_URL="https://us1.unwiredlabs.com/v2/process.php"
OPEN_ELEVATION_URL="https://api.open-elevation.com/api/v1/lookup"
BOT_TOKEN="${BOT_TOKEN:?fehlt in /etc/vanbox/secrets.env}"
CHAT_ID="${CHAT_ID:?fehlt in /etc/vanbox/secrets.env}"
VERBOSE=false
OFFLINE_DATA_DIR="/tmp/offline_location_data"

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
    MESSAGE="$1"
    curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
         -d "chat_id=${CHAT_ID}" \
         -d "text=${MESSAGE}"
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

    RESPONSE=$(curl -s -X POST -H "Content-Type: application/x-www-form-urlencoded" -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=$JWT" https://oauth2.googleapis.com/token)
    ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r .access_token)

    if [ "$ACCESS_TOKEN" = "null" ] || [ -z "$ACCESS_TOKEN" ]; then
        echo "Error retrieving Access Token" >&2
        exit 1
    fi

    echo "$ACCESS_TOKEN" > "$TOKEN_FILE"
    rm -f "$PRIVATE_KEY_FILE"
    log_verbose "New token generated and saved"
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
  "query_time": "$QUERY_TIME"
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
  "query_time": "$QUERY_TIME"
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
  "query_time": "$QUERY_TIME"
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
    for FILE in "$OFFLINE_DATA_DIR"/*; do
        if [ -f "$FILE" ]; then
            log_verbose "Processing offline data from $FILE"
            JSON_PAYLOAD=$(cat "$FILE")
            process_location_data
            if [ $? -eq 0 ]; then
                rm "$FILE"
                log_verbose "Successfully processed and removed $FILE"
            else
                log_verbose "Failed to process $FILE, will retry later"
            fi
        fi
    done
}

# Function to get elevation data
get_elevation() {
    local LAT=$1
    local LON=$2
    local ELEVATION_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -d "{\"locations\":[{\"latitude\":$LAT,\"longitude\":$LON}]}" "$OPEN_ELEVATION_URL")
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
    RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -d "$JSON_PAYLOAD" "$UNWIRED_URL")
    log_verbose "Response from Unwired Labs: $RESPONSE"
    
    if echo "$RESPONSE" | jq -e '.status == "error"' > /dev/null; then
        ERROR_MESSAGE=$(echo $RESPONSE | jq -r '.message')
        log_verbose "Error in location determination: $ERROR_MESSAGE"
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

    # Data to be inserted into Google Sheet (including elevation)
    DATA="{\"values\":[[\"$LAT\",\"$LON\",\"$ORIGINAL_TIME\",\"$ELEVATION\"]]}"

    log_verbose "Sending data to Google Sheets (LAT=$LAT, LON=$LON, ELEVATION=$ELEVATION)"
    # API request to Google Sheets to insert new data
    RESPONSE=$(curl -s -X POST \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "$DATA" \
        "https://sheets.googleapis.com/v4/spreadsheets/$SPREADSHEET_ID/values/$RANGE_NAME:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS")

    if echo "$RESPONSE" | jq -e .updates > /dev/null; then
        echo "Data successfully added to Google Sheets (with elevation: $ELEVATION)"
        echo "$LAT,$LON,$ELEVATION" > "$LAST_ENTRY_FILE"
        # WICHTIG: Vollständige Zellinfo speichern statt nur MCC/MNC
        echo "$CURRENT_CELL_INFO" > "$LAST_CELL_INFO_FILE"
        log_verbose "New data saved in temporary files"
        return 0
    else
        echo "Error adding data to Google Sheets" >&2
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
    RESPONSE=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
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
                
                UPDATE_RESPONSE=$(curl -s -X PUT \
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

    get_network_info
    if [ $? -ne 0 ]; then
        log_verbose "Error retrieving network information"
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

    create_unwired_payload
    if [ $? -ne 0 ]; then
        log_verbose "Error creating Unwired Labs payload"
        exit 1
    fi

    # Try to process offline data first
    process_offline_data

    # Process current location data
    if process_location_data; then
        log_verbose "Current location data processed successfully"
    else
        log_verbose "Failed to process current location data. Saving offline."
        save_offline_data
    fi

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
