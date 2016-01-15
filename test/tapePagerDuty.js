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

var pagerduty_service = {};
pagerduty_service.name = "testPagerDuty" + new Date().valueOf();

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
    t.plan(5);

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
                    
                    body.parameters = {
                    	api_token: nconf.get("pagerduty-token"),
                    	pagerduty_service_name: pagerduty_service.name
                    }
                    
                    //t.comment(pagerduty_service_name);
                    
                    putRequest(url, {header: header, body: JSON.stringify(body)})
                        .then(function(results) {
                            t.equal(results.statusCode, 200, 'did the put instance call succeed?');
                            t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
                            pagerduty_service.id = results.body.instance_id;
                            
                            //t.comment(pagerduty_service.id);
                            
                            // Ensure PagerDuty service has been created
                            // TODO                          
                        });
                });
    });
});

// Utility functions

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
