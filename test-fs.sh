#! /bin/bash -e

HOST=$1

echo "Waiting for $HOST to come up..."
curl -s --retry 3 --retry-delay 2 http://$HOST || exit 1

echo -n "Writing test file... "
dd if=/dev/urandom of=/tmp/testfile.$$ bs=1024 count=50 2>/dev/null
status=$(curl -s -w %{http_code} -X PUT \
  --data-binary @/tmp/testfile.$$ -H "Content-Type: application/octet-stream" \
  http://$HOST/fs/testfile)
if [ "$status" != "204" ]; then
  echo "Failed to write test file, status=$status"
  exit 1
fi
echo "OK"

echo -n "Reading test file... "
status=$(curl -s -w %{http_code} -o /tmp/testfile-get.$$ \
  http://$HOST/fs/testfile)
if [ "$status" != "200" ]; then
  echo "Failed to read test file, status=$status"
  exit 1
fi
if ! cmp /tmp/testfile.$$ /tmp/testfile-get.$$; then
  echo "Read file does not match written file"
  exit 1
fi
echo "OK"

echo -n "Listing files... "
status=$(curl -s -w %{http_code} -o /tmp/files.$$ \
  http://$HOST/fs/)
if [ "$status" != "200" ]; then
  echo "Failed to list files, status=$status"
  exit 1
fi
if ! grep -q testfile /tmp/files.$$; then
  echo "Failed to find testfile in file list"
  exit 1
fi
echo "OK"

echo -n "Deleting test file... "
status=$(curl -s -w %{http_code} -X DELETE \
  http://$HOST/fs/testfile)
if [ "$status" != "204" ]; then
  echo "Failed to delete test file, status=$status"
  exit 1
fi
status=$(curl -s -w %{http_code} -o /dev/null \
  http://$HOST/fs/testfile)
if [ "$status" != "404" ]; then
  echo "Deleted test file still exists, status=$status"
  exit 1
fi
echo "OK"

echo -n "Creating dir... "
status=$(curl -s -w %{http_code} -X PUT \
  http://$HOST/fs/testdir/)
if [ "$status" != "204" ]; then
  echo "Failed to create dir, status=$status"
  exit 1
fi
echo "OK"

echo -n "Writing test file to dir... "
status=$(curl -s -w %{http_code} -X PUT \
  --data-binary @/tmp/testfile.$$ -H "Content-Type: application/octet-stream" \
  http://$HOST/fs/testdir/testfile)
if [ "$status" != "204" ]; then
  echo "Failed to write test file, status=$status"
  exit 1
fi
echo "OK"

echo -n "Deleting dir (should fail)... "
status=$(curl -s -w %{http_code} -X DELETE \
  http://$HOST/fs/testdir/)
if [ "$status" != "400" ]; then
  echo "Deleted dir, status=$status"
  exit 1
fi
echo "OK"

echo -n "Deleting test file from dir... "
status=$(curl -s -w %{http_code} -X DELETE \
  http://$HOST/fs/testdir/testfile)
if [ "$status" != "204" ]; then
  echo "Failed to delete test file, status=$status"
  exit 1
fi
echo "OK"

echo -n "Deleting dir... "
status=$(curl -s -w %{http_code} -X DELETE \
  http://$HOST/fs/testdir/)
if [ "$status" != "204" ]; then
  echo "Failed to delete dir, status=$status"
  exit 1
fi
echo "OK"

echo "Testing 404's..."
echo -n "  File read... "
status=$(curl -s -w %{http_code} -o /dev/null \
  http://$HOST/fs/notexist)
if [ "$status" != "404" ]; then
  echo "Failed: status=$status"
  exit 1
fi
echo "OK"
echo -n "  File write... "
status=$(echo "test" | curl -s -w %{http_code} -o /dev/null -X PUT \
  --data-binary @- http://$HOST/fs/notexist/foo)
if [ "$status" != "404" ]; then
  echo "Failed: status=$status"
  exit 1
fi
echo "OK"
# echo -n "  File delete... "
# status=$(curl -s -w %{http_code} -o /dev/null -X DELETE \
#   http://$HOST/fs/notexist/foo)
# if [ "$status" != "404" ]; then
#   echo "Failed: status=$status"
#   exit 1
# fi
# echo "OK"
echo -n "  Dir read... "
status=$(curl -s -w %{http_code} -o /dev/null \
  http://$HOST/fs/notexist/)
if [ "$status" != "404" ]; then
  echo "Failed: status=$status"
  exit 1
fi
echo "OK"
echo -n "  Dir create... "
status=$(curl -s -w %{http_code} -o /dev/null -X PUT \
  http://$HOST/fs/notexist/testdir/)
if [ "$status" != "404" ]; then
  echo "Failed: status=$status"
  exit 1
fi
echo "OK"
# echo -n "  Dir delete... "
# status=$(curl -s -w %{http_code} -o /dev/null -X DELETE \
#   http://$HOST/fs/notexist/foo/)
# if [ "$status" != "404" ]; then
#   echo "Failed: status=$status"
#   exit 1
# fi
# echo "OK"
