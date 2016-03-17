###############################################################################
# Licensed Materials - Property of IBM
# (c) Copyright IBM Corporation 2015, 2015. All Rights Reserved.
#
# Note to U.S. Government Users Restricted Rights:
# Use, duplication or disclosure restricted by GSA ADP Schedule
# Contract with IBM Corp.
###############################################################################
#!/bin/bash -x

# Copied from /otc-deploy/cf-apps/common/pipeline.build.sh

:<<'USAGE'
SYNOPSIS
--------

export IDS_USER=USERNAME IDS_PASS=PASSWORD pipeline.build.sh

DESCRIPTION
-----------

Injects Git credentials into `package.json`, runs `npm install`, removes all
evidence of credentials from `package.json` and the resulting `node_modules`,
and applies workarounds that inhibit Bluemix from attempting to cache modules.

This allows a codebase containing references to private modules to still be
deployed to Bluemix using an automated Pipeline.

TIPS
----

This script is intended to be run as part of a Pipeline.  Use *ENVIRONMENT
PROPERTIES* to specify the `IDS_USER` and `IDS_PASS`.
USAGE

# Temporarily inject credentials into package.json, do an npm install, and
# restore the original package.json.
# The --production flag is used to not install devDependencies. If there
# is a need for the devDependencies to be installed, a flag could be used.
#
cp package.json{,.orig}
cp npm-shrinkwrap.json{,.orig} >/dev/null 2>&1
node "$(dirname "$0")/inject-auth.js"

if [ -f "npm-shrinkwrap.json" ]; then
    node "$(dirname "$0")/inject-auth-into-npm-shrinkwrap.js"
fi

if ! npm install --production; then
    exit 1
fi

# Filter passwords in GIT urls out of package.json's.
#
# Regexp explanation:
#
# In urls like git+https://SOMETHING@ELSE, strip out the 'SOMETHING@'.
find node_modules \
    -name 'package.json' \
    -exec sed -i 's|\(git+https://\)\([^@]*@\)\(.*\)|\1\3|' '{}' ';'

# Make npm install do nothing in Bluemix.
#
# Start with npm 3, if it's asked to do an npm install, it'll try to make
# node_modules look exactly like whatever's in npm-shrinkwrap.json.  If
# npm-shrinkwrap.json is rigged to be empty, npm install will wipe out
# everything in node_modules.  This is not desired.  Instead, we want npm
# instal to do absolutely nothing.  This involves wiping the dependencies out
# of package.json.
rm -f npm-shrinkwrap.json

# Starting with npm 3 we also need to remove the depenencies from the
# package.json file in order to prevent npm install from doing anything.
node "$(dirname "$0")/remove-deps-from-package-json.js"

# Record the id of this build.  For our purposes, this will be the Git commit
# id followed by a dash, followed by a datestamp with timezone.
#
echo "$GIT_COMMIT-$(date +%Y%m%d%H%M%Z)" > .pipeline_build_id
