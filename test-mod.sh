#! /bin/bash

HOST=$1

echo -n "Waiting for $HOST to come up.."
for i in $(seq 1 10); do
  curl -s -m 2 http://$HOST && break
  echo -n "."
  sleep 2
done
curl -s http://$HOST || exit 1
echo "OK"

echo -n "Erasing mod... "
status=$(curl -s -w %{http_code} -X DELETE http://$HOST/mod/0)
if [ "$status" != "204" ]; then
  echo "Failed to erase mod, status=$status"
  exit 1
fi
echo "OK"

echo -n "Waiting for reset... "
for i in $(seq 1 10); do
  sleep 2
  curl -s -m 2 http://$HOST && break
  echo -n "."
done
echo -n 'works? '
curl -s http://$HOST || exit 1
echo OK

echo -n "Writing mod... "
status=$(curl -s -w %{http_code} -X PUT \
  --data-binary @hello-mod.xsa -H "Content-Type: application/octet-stream" \
  http://$HOST/mod/0)
if [ "$status" != "204" ]; then
  echo "Failed to write mod, status=$status"
  exit 1
fi
echo "OK"

echo -n "Waiting for reset... "
for i in $(seq 1 10); do
  sleep 2
  curl -s -m 2 --connect-timeout 2 http://$HOST && break
  echo -n "."
done
curl -s http://$HOST || exit 1
echo OK
