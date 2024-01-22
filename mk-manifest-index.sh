#! /bin/bash -e
# Lists all the manifests in the bucket, creates an index file, and uploads it
# Assumes manifest file paths have no spaces
# Assumes `aws s3 ls` lists all files (may break when there are over 1000)
# Produces an empty {} at the end to deal with json ',' issues, sigh
PREFIX=${1:-s3://js-board/images}
MANIFESTS=$(aws s3 ls --recursive $PREFIX | grep manifest-flasher.json | awk '{print $4}')
INDEX=/tmp/index.json
echo '{' >$INDEX
for M in $MANIFESTS; do
  echo "  \"${M}\":" >>$INDEX
  aws s3 cp s3://js-board/$M - | sed -e 's/^/  /' >>$INDEX
  echo "  ," >>$INDEX
done
echo '  {}' >>$INDEX
echo '}' >>$INDEX
aws s3 cp $INDEX $PREFIX/manifest-index.json --acl public-read
