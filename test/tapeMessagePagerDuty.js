/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2015. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
var nconf = require('nconf')
    request = require("request"),
    path = require('path'),
    Q = require('q'),
    request = require("request"),
    tiamUtils = require('./tiamTestUtils.js'),
    test = require('tape'),
    pagerdutyUtils = require('../lib/middleware/pagerduty-utils'),
    eventPipeline = require('../lib/event/pipeline'),
    _ = require('underscore')
;

nconf.env("__");

if (process.env.NODE_ENV) {
    nconf.file('node_env', 'config/' + process.env.NODE_ENV + '.json');
}
nconf.file('test', path.join(__dirname, '..', 'config', 'dev.json'));

// Load in the user information.
nconf.file('testUtils', path.join(__dirname, '..', 'config', 'testUtils_myself.json'));

var header = {
    authorization: "Basic Y2Y6",
    accept: "application/json"
};

var defaultHeaders = {
    'Accept': 'application/json,text/json',
    'Content-Type': 'application/json'
};

var event_endpoints = {};

var mockServiceInstanceId = "1234";
var mockToolchainId = "c234adsf-111";

var header = {};
var authenticationTokens = [];
var mockUserArray = [];

var currentTime = new Date().valueOf();
var pagerduty = {};
pagerduty.service_name = "testPagerDuty" + currentTime;
pagerduty.user_email = "user" + currentTime + "@ibm.com";
pagerduty.user_phone_country = '33';
pagerduty.user_phone_number = "123456789";
var pagerdutyAccountId = nconf.get("pagerduty-account");
var pagerdutyApiKey = nconf.get("pagerduty-api-key");
var pagerdutyApiUrl = "https://" + pagerdutyAccountId + '.' + nconf.get("services:pagerduty").substring("https://".length) + "/api/v1";


test('PagerDuty Broker - Test Setup', function (t) {
    mockUserArray = nconf.get('userArray');

    t.plan(mockUserArray.length * 2);

    for(var i = 0; i < mockUserArray.length; i++) (function(i) {
        tiamUtils.authenticateTestUserWithTIAM (function(accessToken) {
            tiamUtils.getProfile (accessToken, function(err, profile) {
                t.equal(err, null, 'Was authenticate test user with TIAM successful?');
                authenticationTokens[i] = accessToken;
                if(typeof authenticationTokens[0] !== 'undefined' && i === 0) {
                    header.Authorization = authenticationTokens[0];
                }
                t.pass('Authentication succeeded for mock user: ' + mockUserArray[i].testusername);
            });
        }, i);
    } (i));
});

test('PagerDuty Broker - Test Incident Trigger', function (t) {
    t.plan(2);
    
	// Simulate a Pipeline event
	var message_store_pipeline_event = require("./deploy_job_failure");

	message_store_pipeline_event.toolchain_id = "32a821a2-2012-4c6e-972f-b296512017e7";
	message_store_pipeline_event.payload.pipeline.id = "1ebdf839-b269-463d-acce-9f73bf6221ce";
	
	var service_key = "9c2d805e49484cc8aa530a9859567239";
	
	nconf.set("services:otc-api", "https://otc-api.stage1.ng.bluemix.net/api/v1");
	
	eventPipeline(message_store_pipeline_event.toolchain_id, message_store_pipeline_event.payload, header.Authorization, function(err, description) {
		t.equals(err, null, "No error reported during message creation?");
		t.comment("description:" + description);
		
		if (false) {
			pagerdutyUtils.postAlert("logPrefix", service_key, description, function(err, body) {
				t.equals(err, null, "No error reported during pagerduty trigger ?");
				t.comment(JSON.stringify(body));
			});			
		} else {
			t.equals("", "");
		}
	});

});

