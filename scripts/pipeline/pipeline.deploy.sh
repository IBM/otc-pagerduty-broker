#!/bin/bash

###############################################################################
# Licensed Materials - Property of IBM
# (c) Copyright IBM Corporation 2015, 2015. All Rights Reserved.
#
# Note to U.S. Government Users Restricted Rights:
# Use, duplication or disclosure restricted by GSA ADP Schedule
# Contract with IBM Corp.
###############################################################################

# Copied from /otc-deploy/cf-apps/common/pipeline.deploy.sh

function usage() {
    cat <<'USAGE'
SYNOPSIS
--------

export CF_SPACE=space
export CF_APP=app-name
export DOMAIN=ng.bluemix.net
export APP_HOSTNAME_STEM=api-services

pipeline.deploy.sh \
 -s NAME:TYPE:PLAN \
 -s ...other required service... \
 -s ...other required service...

OPTIONS
-------

-s NAME:TYPE:PLAN

 Before deploying this app, create a service with the provided name,
 type and plan.  For example, -s otc-db:cloudantNoSQLDB:Shared will create
 a new Cloudant DB service, otc-db using the Shared plan.


ENVIRONMENT VARIABLES
---------------------

APP_HOSTNAME_STEM

 A unique name for this app that is prepended to the hostname prefix.

DOMAIN

 The domain that this microservice should be deployed to.  If present, this
 will override the domain specified in manifest.yml.  For example:

 ng.mybluemix.net


CF_APP

 The prefix for the Cloudfoundry application to deploy to.  In fact, this script will
 deploy to "${CF_APP}-red"


CF_SPACE

 The Cloudfoundry space to deploy this application to.

TIAM_URL

 URL to the TIAM service

TIAM_CLIENT_ID
 
 The client id to access TIAM service

TIAM_CLIENT_SECRET
 
 The client secret to access TIAM service


EXAMPLES
--------

pipeline.deploy.sh \
 -s "Bluemix Dev Database:cloudantNoSQLDB:Shared" \
 -d ng.bluemix.net \
 -h api-services


DESCRIPTION
-----------

Deploy this app to Bluemix.  In the case of this app, this involves creating a
DB, deploying the app, then setting some environment variables.

Where a domain name is specified (using the environment variable, DOMAIN), it
will override the default from the manifest.  This domain will likely be
overridden with ng.bluemix.net or eu-gb.bluemix.net for official deployments.
USAGE
}

SERVICES=

while getopts ':s:' curopt; do
	case $curopt in
		s)
			if [ "$SERVICES" ]; then
				SERVICES=$SERVICES,$OPTARG
			else
				SERVICES=$OPTARG
			fi
			;;
		*)
			usage >&2
			exit 1
			;;
	esac
done

if ! [ "$APP_HOSTNAME_STEM" ]; then
    echo "Required environment variable, APP_HOSTNAME_STEM is not specified" >&2
    usage >&2
    exit 1
fi

if ! [ "$DOMAIN" ]; then
    echo "Required environment variable, DOMAIN is not specified" >&2
    usage >&2
    exit 1
fi

if ! [ "$CF_APP" ]; then
    echo "Required environment variable, CF_APP is not specified" >&2
    usage >&2
    exit 1
fi

if ! [ "$CF_SPACE" ]; then
    echo "Required environment variable, CF_SPACE is not specified" >&2
    usage >&2
    exit 1
fi

# The prefix of this app's hostame.  The actual hostname will have the DOMAIN
# appended.
#
APP_HOSTNAME_PREFIX=$APP_HOSTNAME_STEM-red

# Add the suffix to the app name to allow rollback if needed by the deploy.
APP_NAME=$CF_APP-red

# Determine the hostname of the proxy in-front of this service.  Our convension
# is that where the target CloudFoundry-space is not prod, this should be:
#
# dev-{space}.{domain}
#
# Where the target CloudFoundry-space is prod, this should be dev.{domain}
#
PROXY_HOSTNAME=dev
if [ "$CF_SPACE" -a '(' "$CF_SPACE" '!=' "prod" ')' ]; then
    PROXY_HOSTNAME="$PROXY_HOSTNAME-$CF_SPACE"
fi
PROXY_HOSTNAME=${PROXY_HOSTNAME}.$DOMAIN

echo "$SERVICES" | sed 's/,/\n/g' | while IFS=: read name type plan; do
	cf create-service "$type" "$plan" "$name"
done

if ! [ "$APP_NUM_INSTANCES" ]; then
    APP_NUM_INSTANCES=1
fi

if ! [ "$APP_MEMORY" ]; then
    APP_MEMORY=1G
fi

# Push this service, but don't start it yet.
#
if ! cf push "$APP_NAME" -d "$DOMAIN" -i "$APP_NUM_INSTANCES" -m "$APP_MEMORY" --no-route --no-start; then
	echo "Error pushing this app."
	exit 1
fi

# Map our route(s) to the app.
if ! cf map-route "$APP_NAME" "$DOMAIN" -n "$APP_HOSTNAME_PREFIX"; then
	echo "Could not add unsuffixed route to this app." >&2
	exit 1
fi

# Tell this service where to find the application it's a part of.
#
cf set-env "$APP_NAME" url "https://$PROXY_HOSTNAME"
if [ "$NODE_ENV" ]; then
	cf set-env "$APP_NAME" NODE_ENV "${NODE_ENV}"
else
	cf set-env "$APP_NAME" NODE_ENV "production"
fi
if [ "$STAGE" ]; then
	cf set-env "$APP_NAME" STAGE "${STAGE}"
fi
if [ "$CLOUDANT_DB" ]; then
    cf set-env "$APP_NAME" _vcap_services__cloudantNoSQLDB__0__credentials__url "${CLOUDANT_DB}"  
fi

if [ "$TIAM_URL" ]; then
	cf set-env "$APP_NAME" TIAM_URL "${TIAM_URL}"
fi

if [ "$TIAM_CLIENT_ID" ]; then
	cf set-env "$APP_NAME" TIAM_CLIENT_ID "${TIAM_CLIENT_ID}"
fi

if [ "$ENABLE_NEW_RELIC" ]; then
	cf set-env "$APP_NAME" ENABLE_NEW_RELIC "${ENABLE_NEW_RELIC}"
fi

if [ "$NEW_RELIC_APP_NAME" ]; then
	cf set-env "$APP_NAME" NEW_RELIC_APP_NAME "${NEW_RELIC_APP_NAME}"
fi

if [ "$NEW_RELIC_LICENSE_KEY" ]; then
	cf set-env "$APP_NAME" NEW_RELIC_LICENSE_KEY "${NEW_RELIC_LICENSE_KEY}"
fi

if [ "$TIAM_CLIENT_SECRET" ]; then
	cf set-env "$APP_NAME" TIAM_CLIENT_SECRET "${TIAM_CLIENT_SECRET}"
fi

env | grep _DEPLOY_ | cut -f1 -d= | while read VAR; do
	cf set-env "$APP_NAME"  "${VAR#_DEPLOY_}" "${!VAR}"
done

cf set-env "$APP_NAME" DOMAIN "${DOMAIN}"
# Set the build version info for the /version endpoint.
cf set-env "$APP_NAME" BUILD_NUMBER "$(<.pipeline_build_id)"

# Start this service
#
if ! cf restart "$APP_NAME"; then
	echo "Error restarting this app."
	exit 1
fi

# Display the beginning part of the app's start up logs in case there were
# problems.
#
cf logs "$APP_NAME" --recent 2>&1 | sed 's/^/cf_logs: /' | tail -c2000000

