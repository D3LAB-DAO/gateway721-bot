#!/bin/bash

while true
do
  node updater/bot.js
  echo "Bot crashed. Restarting in 600 seconds..."
  sleep 600
done
