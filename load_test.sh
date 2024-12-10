#!/bin/bash

# Configuration
URLS_FILE="urls.txt"
CONCURRENT_USERS=50
DURATION="60s"

# Run Siege
echo "Starting load test with Siege..."
siege -c$CONCURRENT_USERS -t$DURATION -f $URLS_FILE --content-type "application/json"

# End of script
echo "Load test completed."
