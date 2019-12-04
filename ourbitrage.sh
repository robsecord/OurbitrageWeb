#! /usr/bin/env bash

. ~/.nvm/nvm.sh

nvm use 10.17.0
NODE_ENV=production npm run start
