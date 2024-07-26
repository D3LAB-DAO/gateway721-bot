#!/bin/bash

while true
do
  node responsor/bot.js
  echo "Bot crashed. Restarting in 600 seconds..."
  sleep 600
done
