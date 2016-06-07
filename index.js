/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2016. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
"use strict";

/******************* Begin Synchronous App Configuration **********************/
// Configure nconf and logging early
var nconf = require("nconf"),
	log4js = require("log4js"),
 	util = require('util');

// Configuration for nconf
populateNconfSync();

// Configuration for logging
log4js.configure("./config/log4js.json", {
    reloadSecs: 30
});

var logger = log4js.getLogger("otc-pagerduty-broker"),
 	logBasePath = "index";

// Check if log level has not been overridden
var level = nconf.get("LOG4J_LEVEL");
if (level && level.length > 0)
	logger.setLevel(level);
	
/******************** End Synchronous App Configuration ***********************/

/************* Begin Application Performance Monitoring config ****************/
// Require new relic before any middleware (especially express).
var enableNewRelic = nconf.get('ENABLE_NEW_RELIC');
if (enableNewRelic == 'true') {
    logger.info('New Relic configuring');
    require('newrelic');
    logger.info('New Relic enabled');
}
/*************** End Application Performance Monitoring config ****************/

/******************* Add middleware and start up server ***********************/
var app = require('./app.js');

app.configureMiddleware(function(err) {
    if (err) {
        util.log('Could not start server: ' + JSON.stringify(err));
    }
    else {
        app.server.listen(nconf.get('PORT'));
        util.log('Listening on port ' + nconf.get('PORT'));
    }
});
/**************************** Server listening ********************************/

function populateNconfSync() {
	/* Load up configuration.
	   - ENVVARs override...
	   - Whatever's in the VCAP_SERVICES envvar (parsed as json) which overrides...
	   - config/${NODE_ENV}.json which overrides...
	   - config/dev.json.
	*/
	nconf.env("__");

	var overrides = {};

	if (process.env.VCAP_SERVICES)
		overrides._vcap_services = JSON.parse(process.env.VCAP_SERVICES);

	if (process.env.VCAP_APPLICATION)
		overrides._vcap_application = JSON.parse(process.env.VCAP_APPLICATION);

	if (Object.getOwnPropertyNames(nconf.overrides).length !== 0) {
		nconf.overrides(overrides);
	}

	if (process.env.NODE_ENV)
		nconf.file("node_env", "config/" + process.env.NODE_ENV + ".json");

	nconf.file("default", "config/dev.json");
}
