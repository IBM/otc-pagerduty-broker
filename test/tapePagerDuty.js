/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015, 2015. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
var nconf = require('nconf'),
    request = require("request"),
    path = require('path'),
    Q = require('q'),
    request = require("request"),
    tiamUtils = require('./tiamTestUtils.js'),
    test = require('tape')
;

nconf.env("__");

if (process.env.NODE_ENV) {
    nconf.file('node_env', 'config/' + process.env.NODE_ENV + '.json');
}
nconf.file('test', path.join(__dirname, '..', 'config', 'dev.json'));

// Load in the user information.
nconf.file('testUtils', path.join(__dirname, '..', 'config', 'testUtils.json'));

var header = {
    authorization: "Basic Y2Y6",
    accept: "application/json"
};

var defaultHeaders = {
    'Accept': 'application/json,text/json',
    'Content-Type': 'application/json'
};

var mockServiceInstanceId = "1234";
var mockToolchainId = "c234adsf-111";

var header = {};
var authenticationTokens = [];
var mockUserArray = [];

var currentTime = new Date().valueOf();
var pagerduty = {};
pagerduty.service_name = "testPagerDuty" + currentTime;
pagerduty.user_name = "Test User" + currentTime;
pagerduty.user_email= "user" + currentTime + "@ibm.com";
pagerduty.user_phone_country = '33';
pagerduty.user_phone_number = "123456789";
var pagerdutyApiToken = nconf.get("pagerduty-token");
var pagerdutyApiUrl = nconf.get("services:pagerduty") + "/api/v1";
var postServiceInstanceParameters = {
	api_token: pagerdutyApiToken,
	service_name: pagerduty.service_name,
	user_name: pagerduty.user_name,
	user_email: pagerduty.user_email,
	user_phone: "+" + pagerduty.user_phone_country + " " + pagerduty.user_phone_number
};

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

//Authentication testing
test('PagerDuty Broker - Test Authentication', function (t) {
    t.plan(4);

    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
    var body = {
        'service_id': 'pagerduty',
        'organization_guid': nconf.get('test_app_org_guid')
    };
    var auth = {
        'Authorization': ''
    };

    putRequest(url, {header: null, body: JSON.stringify(body)})
        .then(function(resultNoHeader) {
            t.equal(resultNoHeader.statusCode, 401, 'did the authentication request with no Auth header fail?');

            putRequest(url, {header: auth, body: JSON.stringify(body)})
                .then(function(resultNoToken) {
                    t.equal(resultNoToken.statusCode, 401, 'did the authentication request with an empty Auth header fail?');
                });
                auth.Authorization = 'token';
                putRequest(url, {header: auth, body: JSON.stringify(body)})
                    .then(function(resultNoBearer) {
                        t.equal(resultNoBearer.statusCode, 401, 'did the authentication request with no bearer in the Auth header fail?');
                    });
                    auth.Authorization = 'BEARER token';
                    putRequest(url, {header: auth, body: JSON.stringify(body)})
                    .then(function(resultInvalidToken) {
                        t.equal(resultInvalidToken.statusCode, 401, 'did the authentication request an invalid token in the Auth header fail?');
                    });
    });
});

test('PagerDuty Broker - Test PUT instance', function (t) {
    t.plan(18);

    var url = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/' + mockServiceInstanceId;
    var body = {};

    putRequest(url, {header: header, body: null})
        .then(function(resultNoBody) {
            t.equal(resultNoBody.statusCode, 400, 'did the put instance call with no body fail?');
            body.service_id = 'pagerduty';

            putRequest(url, {header: header, body: JSON.stringify(body)})
                .then(function(resultNoOrg) {
                    t.equal(resultNoOrg.statusCode, 400, 'did the put instance call with no service id fail?');
                    body.organization_guid = nconf.get('test_app_org_guid');
                    
                    body.parameters = postServiceInstanceParameters;
                    
                    //t.comment(pagerduty_service_name);
                    
                    putRequest(url, {header: header, body: JSON.stringify(body)})
                        .then(function(results) {
                            t.equal(results.statusCode, 200, 'did the put instance call succeed?');
                            t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
                            pagerduty.service_id = results.body.instance_id;
                            
                            //t.comment(pagerduty.service_id);
                            
                            // Ensure PagerDuty service and user hasve been created
                            assertServiceAndUser(pagerduty, t);
                            
                            // Ensure dashboard url is accessible
                            var dashboardUrl = results.body.dashboard_url;
                            getRequest(dashboardUrl, {}) .then(function(getResults) {
                                t.notEqual(getResults.statusCode, 404, 'did the get dashboard url call succeed?');
                            });
                        });
                });
    });
});

//Monitoring endpoints
test('PagerDuty Broker - Test GET status', function (t) {
    t.plan(1);

    var url = nconf.get('url') + '/status';
    getRequest(url, {header: null}).then(function(results) {
    	t.equal(results.statusCode, 200, 'did the get status call succeed?');
    });
});

test('PagerDuty Broker - Test GET version', function (t) {
    t.plan(1);

    var url = nconf.get('url') + '/version';
    getRequest(url, {header: null})
        .then(function(results) {
            // Try to get the build number from the pipeline environment variables, otherwise the value is undefined.
            var buildID = process.env.BUILD_NUMBER;
            if(buildID) {
                t.equal(JSON.parse(results.body).build, buildID, 'did the get version call succeed?');
            } else {
                t.equal(results.statusCode, 200, 'did the get version call succeed?');
            }
    });
});

// Utility functions

function assertServiceAndUser(pagerduty, t) {
	var pagerdutyHeaders = {
		'Authorization': 'Token token=' + pagerdutyApiToken
	};
	var url = pagerdutyApiUrl + "/services?query=" + encodeURIComponent(pagerduty.service_name) + "&include[]=escalation_policy";
	request.get({
		uri: url,
		json: true,
		headers: pagerdutyHeaders
	}, function(err, reqRes, body) {
        t.equal(reqRes.statusCode, 200, 'did the get service call succeed?');
        t.equal(body.services.length, 1, 'was only 1 service found?');
        var escalation_policy = body.services[0].escalation_policy;
        t.equal(escalation_policy.name, "Call " + pagerduty.user_name, 'was the right escalation policy created?');
        var escalation_policy_url = pagerdutyApiUrl + "/escalation_policies/" + escalation_policy.id;
    	request.get({
    		uri: escalation_policy_url,
    		json: true,
    		headers: pagerdutyHeaders
    	}, function(err, reqRes, body) {
			t.equal(reqRes.statusCode, 200, 'did the get escalation policy call succeed?');
			t.equal(body.escalation_policy.escalation_rules.length, 1, 'was only 1 escalation rule found?');
			var escalation_rule = body.escalation_policy.escalation_rules[0];
			t.equal(escalation_rule.targets.length, 1, 'was only 1 target user found?');
			var target = escalation_rule.targets[0];
			t.equal(target.name, pagerduty.user_name, 'was the correct user name used?');
			t.equal(target.email, pagerduty.user_email, 'was the correct user email used?');
			var contact_method_url = pagerdutyApiUrl + "/users/" + target.id + "/contact_methods";
			request.get({
				uri: contact_method_url,
				json: true,
				headers: pagerdutyHeaders
			}, function(err, reqRes, body) {
				t.equal(reqRes.statusCode, 200, 'did the get contact methods call succeed?');
				t.equal(body.total, 2, 'were 2 contact methods found?');
				var contact_method = body.contact_methods[1];
				t.equal(contact_method.type, "phone", 'is the contact method\'s type phone?');
				t.equal(contact_method.country_code, Number(pagerduty.user_phone_country), 'is the contact method\'s country right?');
				t.equal(contact_method.phone_number, pagerduty.user_phone_number, 'is the contact method\'s phone number right?');
			});
    	});
        
	});
}

function initializeRequestParams(url, options) {

    var outputObject = {};
    outputObject.headers = JSON.parse(JSON.stringify(defaultHeaders)); //clone without reference

    var header = options.header;

    for(var key in header)  {
        outputObject.headers[key] = header[key];
    }

    if (options.body !== null)    {

        outputObject.json = true;

        outputObject.body = options.body;
    }

    var params = request.initParams(url, outputObject);
    return params;
}

function delRequest(url, options) {
    var params = initializeRequestParams(url, options);

    var del = Q.nbind(request.del, this);
    return del(params.uri, {headers: params.headers})
        .then(function(res) {
            if(res[1]) {
                   return {
                    "statusCode": res[0].statusCode,
                    "body": JSON.parse(res[1])
                };
            } else {
                return {
                    "statusCode": res[0].statusCode
                };
            }
        });
}

function getRequest(url, options) {
    var params = initializeRequestParams(url, options);

    var get = Q.nbind(request.get, this);
    return get(params.uri, {headers: params.headers})
        .then(function(res) {
            if(res[1]) {
                // The /status endpoint doesn't return JSON so
                // the body isn't parsed.
                return {
                    "statusCode": res[0].statusCode,
                    "body": res[1]
                };
            } else {
                return {
                    "statusCode": res[0].statusCode
                };
            }
        });
}

function putRequest(url, options) {
    var params = initializeRequestParams(url, options);

    var put = Q.nbind(request.put, this);
    return put(params.uri, {body: params.body, headers: params.headers})
        .then(function(res) {
            if(res[1]) {
                   return {
                    "statusCode": res[0].statusCode,
                    "body": JSON.parse(res[1])
                };
            } else {
                return {
                    "statusCode": res[0].statusCode
                };
            }
        });
}
