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
pagerduty.user_phone_number = "1234567890";
var pagerdutyAccountId = nconf.get("pagerduty-account");
pagerdutyAccountId = "jauninb";
var pagerdutyApiKey = nconf.get("jauninb-api-key");
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

test('PagerDuty Broker - Test Get Or Create User', function (t) {
    t.plan(2);
    
    pagerdutyUtils.getOrCreatePagerDutyUser(null, pagerdutyApiUrl, pagerdutyApiKey, "New User", pagerduty.user_email,
    		"+" + pagerduty.user_phone_country +  " " + pagerduty.user_phone_number, function(user) {
    	t.ok(user, "is new user created?");
    });
    
    pagerdutyUtils.getOrCreatePagerDutyUser(null, pagerdutyApiUrl, pagerdutyApiKey, "jaunin b", "jauninb@yahoo.fr",
    		"+" + pagerduty.user_phone_country +  " " + pagerduty.user_phone_number, function(user) {
    	t.ok(user, "is existing user found and updated?");
    });
    

});

