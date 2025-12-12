#!/bin/bash
# Script to sync root-level agents to extraction-script
cd extraction-script

# Remove old copies
rm -rf primary_agent secondary_agent shared

# Copy from root
cp -r ../primary_agent .
cp -r ../secondary_agent .
cp -r ../shared .

# Fix import paths in copied files to work within extraction-script
find secondary_agent -name "*.ts" -type f -exec sed -i "s|'../extraction-script/lib/|'@/lib/|g" {} \;
find secondary_agent -name "*.ts" -type f -exec sed -i "s|\"../extraction-script/lib/|\"@/lib/|g" {} \;
find secondary_agent -name "*.ts" -type f -exec sed -i "s|'../shared/|'@/shared/|g" {} \;
find secondary_agent -name "*.ts" -type f -exec sed -i "s|\"../shared/|\"@/shared/|g" {} \;
find primary_agent -name "*.ts" -type f -exec sed -i "s|'../shared/|'@/shared/|g" {} \;
find primary_agent -name "*.ts" -type f -exec sed -i "s|\"../shared/|\"@/shared/|g" {} \;

echo "Agents synced successfully"
