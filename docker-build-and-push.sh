#!/bin/bash

version=$(cat package.json \
  | grep version \
  | head -1 \
  | awk -F: '{ print $2 }' \
  | sed 's/[",]//g')

version="$(echo -e "${version}" | sed -e 's/^[[:space:]]*//')"
echo "Docker image: ampnet/auto-funder:$version"
docker build -t ampnet/auto-funder:$version -t ampnet/auto-funder:latest .
docker push ampnet/auto-funder:$version
docker push ampnet/auto-funder:latest