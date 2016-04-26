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
    async = require("async"),
    test = require('tape-catch'),
    _ = require('underscore')
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

//var event_endpoints = {};

var organization_guid = "some uuid";
var mockServiceInstanceId = "1234";
var mockToolchainId = "c234adsf-111";
var serviceInstanceUrlPrefix = nconf.get('url') + '/pagerduty-broker/api/v1/service_instances/';
var serviceInstanceUrl = serviceInstanceUrlPrefix + mockServiceInstanceId;
var unknownUserEmail = "unknown_user@email.com";

var tiamCredentials = {};

var header = {};

var currentTime = new Date().valueOf();

var pagerdutySiteName = nconf.get("pagerduty-site-name");
var pagerdutyApiKey = nconf.get("pagerduty-api-key");
var pagerdutyDefaultHeaders = {'Authorization': 'Token token=' + pagerdutyApiKey};
var pagerdutyApiUrl = "https://" + pagerdutySiteName + '.' + nconf.get("services:pagerduty").substring("https://".length) + "/api/v1";

var testId = 0;
var testNumber = 0; // cannot use the same var as testId is incremented when the tests are read by tape, not when they are executed

var toDelete = [];

function setup(t) {
    testNumber++;
}

function teardown(t) {
	// Delete service instances, PagerDuty services, escalation policies and users created by the test
	deleteAllFrom(toDelete, 0, ['service_instance', 'pagerduty_service', 'escalation_policy', 'user'], 0, t);
	toDelete = [];
	
}

function test_(name, testCode) {
	test('Setup', function(t) {
    	setup(t);
    	t.end();
	});
	test(name, function(t) {
		testCode(t);
	});
	test('Teardown', function(t) {
		teardown(t);
		t.end();
	});
}

//Authentication testing
test_(++testId + ' PagerDuty Broker - Test Authentication', function (t) {
    t.plan(3);

    var body = {
        'service_id': 'pagerduty',
        'organization_guid': organization_guid
    };
    var auth = {
        'Authorization': ''
    };

    // Security Model since Public-beta
    header.Authorization = "Basic " + new Buffer(nconf.get("TIAM_CLIENT_ID") + ":" + nconf.get("OTC_API_BROKER_SECRET")).toString('base64');
    
	async.series([
		function(callback) {
			// no header
			putServiceInstance(serviceInstanceUrl, null, body, function(resultNoHeader) {
				t.equal(resultNoHeader.statusCode, 401, 'did the authentication request with no Auth header fail?');
				callback();
			});
		},
		function(callback) {
			// empty header
			putServiceInstance(serviceInstanceUrl, auth, body, function(resultEmptyHeader) {
                t.equal(resultEmptyHeader.statusCode, 401, 'did the authentication request with an empty Auth header fail?');
				callback();
			});
		},
		function(callback) {
			// no basic token
            auth.Authorization = 'basic';
            putServiceInstance(serviceInstanceUrl, auth, body, function(resultInvalidCreds) {
				t.equal(resultInvalidCreds.statusCode, 401, 'did the authentication request with no basic creads in the Auth basic header fail?');
				callback();
			});
		}
	], function(err, results) {
   		if (err) {
   			t.fail(err);
   		}
	});
});

test(++testId + ' PagerDuty Broker - Create Test TIAM Creds', function(t) {
	t.plan(3);
	var tiamHeader = {};
	tiamHeader.Authorization = "Basic " + new Buffer(nconf.get("test-tiam-id") + ":" + nconf.get("test-tiam-secret")).toString('base64');
	// Create a service credentials
	var url = nconf.get("TIAM_URL") + '/service/manage/pagerduty/' + mockServiceInstanceId;
	//t.comment(url);
    postRequest(url, {header: tiamHeader})
	    .then(function(result) {
	    	t.notEqual(result.body.service_credentials, undefined, "service credentials created ?");
	    	tiamCredentials.service_credentials = result.body.service_credentials;
	    });        		
    
    // Create a toolchain credentials
    url = url + "/" + mockToolchainId;
    postRequest(url, {header: tiamHeader})
    .then(function(result) {
    	t.notEqual(result.body.toolchain_credentials, undefined, "toolchain credentials created ?");
    	tiamCredentials.toolchain_credentials = result.body.toolchain_credentials;
    });        		
    
    // Create an target_credentials credentials to access the pagerduty serviceid and toolchain
    url = nconf.get("TIAM_URL") + '/service/manage/credentials?target=' + mockServiceInstanceId + '&toolchain=' + mockToolchainId;
    postRequest(url, {header: tiamHeader})
    .then(function(result) {
    	t.notEqual(result.body.target_credentials, undefined, "target_credentials created ?");
    	tiamCredentials.target_credentials = result.body.target_credentials;
    });        		
    
});

test_(++testId + ' PagerDuty Broker - Test PUT instance with wrong parameters', function (t) {
    t.plan(10);

    var body = {};
    
    async.series([
       function(callback) {
    	   // no body
    	    putServiceInstance(serviceInstanceUrl, header, null/*body*/, function(resultNoBody) {
                t.equal(resultNoBody.statusCode, 400, 'did the put instance call with no body fail?');
                callback();
            });
       },
       function (callback) {
    	   // no service_credentials
           body.service_id = 'pagerduty';
           putServiceInstance(serviceInstanceUrl, header, body, function(resultNoOrg) {
                t.equal(resultNoOrg.statusCode, 400, 'did the put instance call with no organization_guid fail?');
                callback();
           });    	   
       }, 
       function (callback) {
    	   // no organization_guid
		   body.service_credentials = tiamCredentials.service_credentials;
           body.service_id = 'pagerduty';
           putServiceInstance(serviceInstanceUrl, header, body, function(resultNoOrg) {
                t.equal(resultNoOrg.statusCode, 400, 'did the put instance call with no organization_guid fail?');
                callback();
           });    	   
       }, 
       function (callback) {
    	   // wrong api_key
           body.organization_guid = organization_guid;
           body.parameters = getPostServiceInstanceParameters(getTestPagerDutyInfo());
           body.parameters.api_key = "wrong" + body.parameters.api_key; 
           putServiceInstance(serviceInstanceUrl, header, body, function(results) {
               t.equal(results.statusCode, 400, 'did the put instance with wrong api_key failed?');
               callback();
           });    	   
       },
       function (callback) {
    	   // wrong site_name
           body.parameters = getPostServiceInstanceParameters(getTestPagerDutyInfo());
           body.parameters.site_name = "wrong" + body.parameters.site_name; 
           putServiceInstance(serviceInstanceUrl, header, body, function(results) {
               t.equal(results.statusCode, 400, 'did the put instance with wrong site_name failed?');
               t.equal(results.body.description, "Unknown site_name: " + body.parameters.site_name, 'was the correct description returned?');
               callback();
           });    	   
       },
       function (callback) {
    	   // wrong site_name (email address case)
           body.parameters = getPostServiceInstanceParameters(getTestPagerDutyInfo());
           body.parameters.site_name = "user@email.com"; 
           putServiceInstance(serviceInstanceUrl, header, body, function(results) {
               t.equal(results.statusCode, 400, 'did the put instance with wrong site_name (email address case) failed?');
               t.equal(results.body.description, "Invalid site_name: " + body.parameters.site_name, 'was the correct description returned?');
               callback();
           });    	   
       },
       function (callback) {
    	   // wrong email
           body.parameters = getPostServiceInstanceParameters(getTestPagerDutyInfo());
           body.parameters.user_email = "test@gmail"; 
           putServiceInstance(serviceInstanceUrl, header, body, function(results) {
               t.equal(results.statusCode, 400, 'did the put instance with wrong email failed?');
               callback();
           });    	   
       },
       function (callback) {
    	   // wrong phone number
           body.parameters = getPostServiceInstanceParameters(getTestPagerDutyInfo());
           body.parameters.user_phone = "0123"; 
           putServiceInstance(serviceInstanceUrl, header, body, function(results) {
               t.equal(results.statusCode, 400, 'did the put instance with wrong phone failed?');
               callback();
           });    	   
       }
    ], function(err, results) {
    	if (err) {
    		t.fail(err);
    	}
    });
});

test_(++testId + ' PagerDuty Broker - Test PUT instance', function (t) {
    t.plan(19);

    var pagerduty = getTestPagerDutyInfo();
    var body = getNewInstanceBody(pagerduty);
    putServiceInstance(serviceInstanceUrl, header, body, function(results) {
        t.equal(results.statusCode, 200, 'did the put instance call succeed?');
        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
        
        // Ensure PagerDuty service and user have been created
        assertServiceAndUser(pagerduty, t);
        
        // Ensure dashboard url is accessible
        assertDashboardAccessible(results.body, t);
    });
});

test_(++testId + ' PagerDuty Broker - Test PUT instance with names being prefix of existing ones', function (t) {
    t.plan(20);
    
	async.series([
		function(callback) {
			// instance with suffix names
		    var pagerduty = getTestPagerDutyInfo();
		    pagerduty.service_name = pagerduty.service_name + " Suffix";
		    pagerduty.user_email = pagerduty.user_email + ".suffix";
    		var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// instance with prefix names
			var pagerduty = getTestPagerDutyInfo();
		    var body = getNewInstanceBody(pagerduty);
		    putServiceInstance(serviceInstanceUrl, header, body, function(results) {
		        t.equal(results.statusCode, 200, 'did the second put instance call succeed?');
		        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
		        
		        // Ensure PagerDuty service and user have been created
		        assertServiceAndUser(pagerduty, t);
		        
		        // Ensure dashboard url is accessible
		        assertDashboardAccessible(results.body, t);
		        
				callback();
			});
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test PUT instance reusing existing PagerDuty service', function (t) {
    t.plan(6);
    
    var pagerduty = getTestPagerDutyInfo();
	async.series([
		function(callback) {
			// first instance
    		var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// second instance reuse service of first instance
	        var pagerduty2 = {};
	        pagerduty2.service_name = pagerduty.service_name;	
		    var body = getNewInstanceBody(pagerduty2);
		    putServiceInstance(serviceInstanceUrl, header, body, function(results) {
		        t.equal(results.statusCode, 200, 'did the second put instance call succeed?');
		        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
		        
		        // Ensure PagerDuty service is reused
		        assertService(pagerduty2, t, null);
		        
		        // Ensure dashboard url is accessible
		        assertDashboardAccessible(results.body, t);
		         
		        callback();
			});
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test PUT instance reusing existing PagerDuty service with new user', function (t) {
    t.plan(11);
    
    var pagerduty = getTestPagerDutyInfo();
	async.series([
		function(callback) {
			// first instance
    		var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// second instance reuse service of first instance
	        var pagerduty2 = {};
	        pagerduty2.service_name = pagerduty.service_name;	
	        pagerduty2.user_email = "user" + testNumber + "_" + currentTime + "2@ibm.com";
		    var body = getNewInstanceBody(pagerduty2);
		    putServiceInstance(serviceInstanceUrl, header, body, function(results) {
		        t.equal(results.statusCode, 200, 'did the second put instance call succeed?');
		        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
		        
		        // Ensure a new user is created as primary contact, and the previous user is still a contact
		        assertService(pagerduty2, t, function(t, pagerdutyHeaders, service) {
			        var escalation_policy = service.escalation_policy;
			        var escalation_policy_url = pagerdutyApiUrl + "/escalation_policies/" + escalation_policy.id;
			    	request.get({
			    		uri: escalation_policy_url,
			    		json: true,
			    		headers: pagerdutyHeaders
			    	}, function(err, reqRes, body) {
						t.equal(reqRes.statusCode, 200, 'did the get escalation policy call succeed?');
						t.equal(body.escalation_policy.escalation_rules.length, 2, 'were 2 escalation rules found?');
						var escalation_rule1 = body.escalation_policy.escalation_rules[0];
						t.equal(escalation_rule1.targets.length, 1, 'was only 1 target user found?');
						var target1 = escalation_rule1.targets[0];
						t.equal(target1.name, "Primary contact (" + pagerduty2.user_email + ")", 'is the first target user correct?');
						var escalation_rule2 = body.escalation_policy.escalation_rules[1];
						t.equal(escalation_rule2.targets.length, 1, 'was only 1 target user found?');
						var target2 = escalation_rule2.targets[0];
						t.equal(target2.name, "Contact (" + pagerduty.user_email + ")", 'is the second target user correct?');
				        callback();
					});
		        });
		        
			});
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test PUT instance missing phone number', function (t) {
    t.plan(12);
    
    var pagerduty = getTestPagerDutyInfo();
    delete pagerduty.user_phone_country;
    delete pagerduty.user_phone_number;

    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
	var body = getNewInstanceBody(pagerduty);
    putServiceInstance(serviceInstanceUrl2, header, body, function(results) {
        t.equal(results.statusCode, 200, 'did the put instance call succeed?');
        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
        
        // Ensure PagerDuty service and user have been created
        assertServiceAndUser(pagerduty, t);
    });
});

test_(++testId + ' PagerDuty Broker - Test PUT instance missing email', function (t) {
	// user email is not mandatory, if not present a default user should be used ("unknown_user@email.com")
    t.plan(18);
    
    var pagerduty = getTestPagerDutyInfo();
    delete pagerduty.user_email;

    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var body = getNewInstanceBody(pagerduty);
    putServiceInstance(serviceInstanceUrl2, header, body, function(results) {
        t.equal(results.statusCode, 200, 'did the put instance call succeed?');
        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
        
        // Ensure PagerDuty service and default user have been created
        pagerduty.user_email = unknownUserEmail;
        assertServiceAndUser(pagerduty, t);
    });
});

test_(++testId + ' PagerDuty Broker - Test PUT instance missing email and phone number', function (t) {
	// user email is not mandatory, if not present a default user should be used ("unknown_user@email.com")
    t.plan(12);
    
    var pagerduty = getTestPagerDutyInfo();
    delete pagerduty.user_email;
    delete pagerduty.user_phone_country;
    delete pagerduty.user_phone_number;

    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var body = getNewInstanceBody(pagerduty);
    putServiceInstance(serviceInstanceUrl2, header, body, function(results) {
        t.equal(results.statusCode, 200, 'did the put instance call succeed?');
        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
        
        // Ensure PagerDuty service and default user have been created
        pagerduty.user_email = unknownUserEmail;
        assertServiceAndUser(pagerduty, t);
    });
});

// Patch tests
test_(++testId + ' PagerDuty Broker - Test PATCH update instance with site_name and api_key', function (t) {
    t.plan(20);
	
    var pagerduty = getTestPagerDutyInfo();
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
 	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl2, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch site_name and api_key
		    var body = {};
		    var pagerdutySiteName2 = nconf.get("pagerduty-site-name-2");
		    var pagerdutyApiKey2 = nconf.get("pagerduty-api-key-2");
		    body.parameters = {
		    	"site_name": pagerdutySiteName2,
		    	"api_key": pagerdutyApiKey2
		    };
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
	            t.equal(resultFromPatch.body.parameters.site_name, pagerdutySiteName2, 'did the patch instance call return the right site name?');
	            t.equal(resultFromPatch.body.parameters.api_key, pagerdutyApiKey2, 'did the patch instance call return the right API key?');
		        // check that the service is created on new site
		        var apiUrl2 = "https://" + pagerdutySiteName2 + '.' + nconf.get("services:pagerduty").substring("https://".length) + "/api/v1";
		        assertServiceAndUserOnPagerDutySite(apiUrl2, pagerdutyApiKey2, pagerduty, t);
		        callback();
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test PATCH wrong api_key', function (t) {
    t.plan(2);
	
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var pagerduty = getTestPagerDutyInfo();
	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl2, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch with wrong api_key
		    var body = {};
		    body.parameters = {
		    	"api_key": "wrong"
		    };
		    
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
				t.equal(resultFromPatch.statusCode, 400, 'did the patch instance call with wrong api_key failed?');
		    });    				
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test PATCH with invalid site_name', function (t) {
    t.plan(5);
	
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var pagerduty = getTestPagerDutyInfo();
	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl2, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch with invalid site_name
		    var body = {};
		    var newSiteName = "http://ibm.com";
		    body.parameters = {
		    	"site_name": newSiteName
		    };
		    
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 400, 'did the patch instance call return a bad request?');
		        t.equal(resultFromPatch.body.description, "Invalid site_name: " + newSiteName, 'is the bad request message correct?');
		        callback();
		    });    				
		},
		function(callback) {
			// patch with invalid site_name (email address case)
		    var body = {};
		    var newSiteName = "user@email.com";
		    body.parameters = {
		    	"site_name": newSiteName
		    };
		    
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 400, 'did the patch instance call return a bad request?');
		        t.equal(resultFromPatch.body.description, "Invalid site_name: " + newSiteName, 'is the bad request message correct?');
		    });    				
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});


test_(++testId + ' PagerDuty Broker - Test PATCH update service_name', function (t) {
    t.plan(19);
	
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var pagerduty = getTestPagerDutyInfo();
	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl2, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch service_name
		    var body = {};
		    var newServiceName = "(Updated) " + pagerduty.service_name;
		    body.parameters = {
		    	"service_name": newServiceName
		    };
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
		        t.equal(resultFromPatch.body.parameters.service_name, newServiceName, 'did the patch instance call return the right service name?');
		        addServiceToDelete(null, null, resultFromPatch.body.dashboard_url, pagerdutyDefaultHeaders, function() {
					// check that the service is created
					pagerduty.service_name = newServiceName;
			        assertServiceAndUser(pagerduty, t);
			        callback();
		        });
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test PATCH update user_email', function (t) {
    t.plan(19);
	
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var pagerduty = getTestPagerDutyInfo();
	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl2, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch user_email
		    var body = {};
		    var newEmail =  "user" + testNumber + "_" + currentTime + ".updated@ibm.com";
		    body.parameters = {
		    	"user_email": newEmail
		    };
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
     			t.equal(resultFromPatch.body.parameters.user_email, newEmail, 'did the patch instance call return the right email?');
		        addServiceToDelete(null, null, resultFromPatch.body.dashboard_url, pagerdutyDefaultHeaders, function() {
					// check that the service is updated
					pagerduty.user_email = newEmail;
			        assertServiceAndUser(pagerduty, t);
			        callback();
		        });
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test PATCH update user_phone', function (t) {
    t.plan(35);
	
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var pagerduty = getTestPagerDutyInfo();
	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl2, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch user_phone
		    var body = {};
		    var newUserPhoneNumber = "987654321"
		    var newPhone = "+" + pagerduty.user_phone_country + " " + newUserPhoneNumber;
		    body.parameters = {
		    	"user_phone": newPhone
		    };
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
     			t.equal(resultFromPatch.body.parameters.user_phone, newPhone, 'did the patch instance call return the right phone?');
		        // check that the old phone number is still registered
		        assertServiceAndUser(pagerduty, t);
		        // check that the new phone number is registered 
		        pagerduty.user_phone_number = newUserPhoneNumber;
		        assertServiceAndUser(pagerduty, t);
		        callback();
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test PATCH unknown instance', function (t) {
    t.plan(1);
	
    var serviceInstanceUrl2 = serviceInstanceUrlPrefix + 'unknow_service';
    var body = {};
    var newEmail =  "user" + testNumber + "_" + currentTime + ".updated@ibm.com";
    body.parameters = {
    	"user_email": newEmail
    };
    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
        t.equal(resultFromPatch.statusCode, 404, 'did the patch instance call fail?');
    });    
});

test_(++testId + ' PagerDuty Broker - Test PATCH user_info', function (t) {
    t.plan(2);
	
    var serviceInstanceUrl2 = serviceInstanceUrl + '_' + testNumber;
    var pagerduty = getTestPagerDutyInfo();
	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl2, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the first put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// patch with body.user_info
		    var body = {};
		    var newEmail =  "user" + testNumber + "_" + currentTime + ".updated@ibm.com";
		    body.parameters = {
		    	"user_email": newEmail
		    };
  			body.user_info = "some user info";
		    patchRequest(serviceInstanceUrl2, {header: header, body: JSON.stringify(body)}).then(function(resultFromPatch) {
		        t.equal(resultFromPatch.statusCode, 200, 'did the patch instance call succeed?');
		        callback();
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

// Bind tests
test_(++testId + ' PagerDuty Broker - Test PUT bind instance to toolchain', function (t) {
    t.plan(3);

    var toolchainUrl = serviceInstanceUrl + '/toolchains/'+ mockToolchainId;
	async.series([
		function(callback) {
			// create service instance
		    var pagerduty = getTestPagerDutyInfo();
   			var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the put instance call succeed?');
        		removeFromToDelete('service_instance', serviceInstanceUrl); // keep the service instance for now, it will be used by tests below, and deleted by another test
				callback();
			});
		},
		function(callback) {
			// bind service instance to toolchain
		    putRequest(toolchainUrl, {header: header}).then(function(resultsFromBind) {
		        t.equal(resultsFromBind.statusCode, 400, 'did the bind instance w/o toolchain_credentials failed?');
			    putRequest(toolchainUrl, {header: header, body: JSON.stringify({toolchain_credentials: tiamCredentials.toolchain_credentials})}).then(function(resultsFromBind) {
			        t.equal(resultsFromBind.statusCode, 204, 'did the bind instance to toolchain call succeed?');
			        //t.comment(JSON.stringify(resultsFromBind));
//			        if (_.isString(resultsFromBind.body.toolchain_lifecycle_webhook_url)) {
//			            t.ok(resultsFromBind.body.toolchain_lifecycle_webhook_url, 'did the toolchain_lifecycle_webhook_url value returned and valid ?');
//			            t.comment("resultsFromBind="+ JSON.stringify(resultsFromBind));
//			            event_endpoints.toolchain_lifecycle_webhook_url = resultsFromBind.body.toolchain_lifecycle_webhook_url;
//			        } else {
//			            t.notOk(resultsFromBind.body.toolchain_lifecycle_webhook_url, 'is not a valid returned url for toolchain_lifecycle_webhook_url ?');            	
//			        }
			    });
		    });
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test PUT bind unknown instance to unknown toolchain', function (t) {
    t.plan(1);

    var toolchainUrl = serviceInstanceUrlPrefix + 'unknow_service/toolchains/unknow_toolchain';
    putRequest(toolchainUrl, {header: header, body: JSON.stringify({toolchain_credentials: tiamCredentials.toolchain_credentials})}).then(function(resultsFromBind) {
        t.equal(resultsFromBind.statusCode, 404, 'did the bind instance to toolchain call fail?');
    });

});

// Events tests
test_(++testId + ' PagerDuty Broker - Test Messaging Store Like Event - Deploy job failed', function (t) {
	t.plan(8);
	
	var pagerDutyServiceId;
	var incidentNumber;
	async.series([
		function(callback) {
			// create instance
		    var pagerduty = getTestPagerDutyInfo();
    		var body = getNewInstanceBody(pagerduty);
			putServiceInstance(serviceInstanceUrl, header, body, function(results) {
        		t.equal(results.statusCode, 200, 'did the put instance call succeed?');
      			pagerDutyServiceId = results.body.instance_id;
				callback();
			});
		},
		function(callback) {
			// bind service instance to toolchain
		    var toolchainUrl = serviceInstanceUrl + '/toolchains/'+ mockToolchainId;
		    putRequest(toolchainUrl, {header: header, body: JSON.stringify({toolchain_credentials: tiamCredentials.toolchain_credentials})}).then(function(resultsFromBind) {
		        t.equal(resultsFromBind.statusCode, 204, 'did the bind instance to toolchain call succeed?');
		        callback();
		    });
		},
		function(callback) {
			// simulate a Pipeline event
			var messagingEndpoint = nconf.get('url') + '/pagerduty-broker/api/v1/messaging/accept';
			var message_store_pipeline_event = require("./deploy_job_failure");
			message_store_pipeline_event.toolchain_id = mockToolchainId;
			message_store_pipeline_event.instance_id = mockServiceInstanceId;
			
			var basicHeader = {Authorization: "Basic " + tiamCredentials.target_credentials};
			postRequest(messagingEndpoint, {header: basicHeader, body: JSON.stringify(message_store_pipeline_event)}).then(function(resultFromPost) {
		        t.equal(resultFromPost.statusCode, 204, 'did the message store like event sending call succeed?');
				callback();
			});
		},
		function(callback) {
			// assert incident (wait 30s max)
	        getIncident(pagerDutyServiceId, Date.now() + 30000, function(incident, err) {
	        	t.equal(err, undefined, 'did the calls to get the incident succeed?');
	        	var description = incident == undefined ? undefined : incident.trigger_summary_data.description;
	        	t.equal(description, "Job 'Deploy to prod' in Stage 'PROD' #4 of Pipeline '80f22ae7-5a63-4af4-9b14-c2be9d512177' from Toolchain 'c234adsf-111' has FAILED", 'was the incident description correct?');
	        	incidentNumber = incident == undefined ? undefined : incident.incident_number;
	        	callback();
	        })
		},
		function(callback) {
			// resolve incident
	        resolveIncident(incidentNumber, getTestUserEmail(), t);
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
	
});

test_(++testId + ' PagerDuty Broker - Test Messaging Store Like Event - Unknown service_id', function (t) {
	t.plan(1);
	
	// Message Store Event endpoint
	var messagingEndpoint = nconf.get('url') + '/pagerduty-broker/api/v1/messaging/accept';

	// Simulate a Pipeline event
	var message_store_pipeline_event = require("./deploy_job_failure");
	message_store_pipeline_event.toolchain_id = mockToolchainId;
	message_store_pipeline_event.instance_id = mockServiceInstanceId;
	message_store_pipeline_event.service_id = 'unknown';
	
	var basicHeader = {Authorization: "Basic " + tiamCredentials.target_credentials};

    postRequest(messagingEndpoint, {header: basicHeader, body: JSON.stringify(message_store_pipeline_event)}).then(function(resultFromPost) {
        t.equal(resultFromPost.statusCode, 204, 'did the message store like event sending call succeed?');
    });	
	
});

// Delete tests
test_(++testId + ' PagerDuty Broker - Test DELETE instance', function (t) {
    t.plan(2);

	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(getTestPagerDutyInfo());
			putServiceInstance(serviceInstanceUrl, header, body, function(results) {
		        t.equal(results.statusCode, 200, 'did the put instance call succeed?');
				callback();
			});
		},
		function(callback) {
			// delete instance
		    delRequest(serviceInstanceUrl, {header: header}).then(function(resultsFromDel) {
				t.equal(resultsFromDel.statusCode, 204, 'did the delete instance call succeed?');
				removeFromToDelete('service_instance', serviceInstanceUrl); // do not try to delete it again
		    });
    	}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test DELETE unknown instance', function (t) {
    t.plan(1);

    var serviceInstanceUrl2 = serviceInstanceUrlPrefix + 'unknown_service';
    delRequest(serviceInstanceUrl2, {header: header}).then(function(resultsFromDel) {
		t.equal(resultsFromDel.statusCode, 404, 'did the delete instance call fail?');
    });
});

// Unbind test, the service instance will still remain in the DB
test_(++testId + ' PagerDuty Broker - Test DELETE unbind instance from toolchain', function (t) {
    t.plan(4);

	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(getTestPagerDutyInfo());
			putServiceInstance(serviceInstanceUrl, header, body, function(results) {
		        t.equal(results.statusCode, 200, 'did the put instance call succeed?');
		        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
				callback();
			});
		},
		function(callback) {
			// bind service instance to toolchain
		    putRequest(serviceInstanceUrl + '/toolchains/'+ mockToolchainId, {header: header, body: JSON.stringify({toolchain_credentials: tiamCredentials.toolchain_credentials})}).then(function(resultsFromBind) {
                t.equal(resultsFromBind.statusCode, 204, 'did the bind instance to toolchain call succeed?');
		        callback();
		    });    
		},
		function(callback) {
			// unbind service instance from toolchain 
		    delRequest(serviceInstanceUrl + '/toolchains/'+ mockToolchainId, {header: header}).then(function(resultsFromDel) {
				t.equal(resultsFromDel.statusCode, 204, 'did the unbind instance call succeed?');
		        callback();
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test_(++testId + ' PagerDuty Broker - Test DELETE unbind unnknown instance from unknown toolchain', function (t) {
    t.plan(1);

    delRequest(serviceInstanceUrlPrefix + 'unknown_instance/toolchains/unknown_toolchain', {header: header}).then(function(resultsFromDel) {
		t.equal(resultsFromDel.statusCode, 404, 'did the unbind instance call failed?');
    });
});


// Unbind and delete test
test_(++testId + ' PagerDuty Broker - Test DELETE unbind instance from toolchain and delete it', function (t) {
    t.plan(5);

	async.series([
		function(callback) {
			// create service instance
   			var body = getNewInstanceBody(getTestPagerDutyInfo());
			putServiceInstance(serviceInstanceUrl, header, body, function(results) {
		        t.equal(results.statusCode, 200, 'did the put instance call succeed?');
		        t.ok(results.body.instance_id, 'did the put instance call return an instance_id?');
				callback();
			});
		},
		function(callback) {
			// bind service instance to toolchain
		    putRequest(serviceInstanceUrl + '/toolchains/'+ mockToolchainId, {header: header, body: JSON.stringify({toolchain_credentials: tiamCredentials.toolchain_credentials})}).then(function(resultsFromBind) {
                t.equal(resultsFromBind.statusCode, 204, 'did the bind instance to toolchain call succeed?');
		        callback();
		    });    
		},
		function(callback) {
			// unbind service instance from toolchain
		    delRequest(serviceInstanceUrl + '/toolchains/'+ mockToolchainId, {header: header}).then(function(resultsFromDel) {
				t.equal(resultsFromDel.statusCode, 204, 'did the unbind instance call succeed?');
		        callback();
		    });    
		},
		function(callback) {
			// delete service instance
		     delRequest(serviceInstanceUrl, {header: header}).then(function(resultsFromDel) {
				t.equal(resultsFromDel.statusCode, 204, 'did the delete instance call succeed?');
				removeFromToDelete('service_instance', serviceInstanceUrl); // do not try to delete it again
		        callback();
		    });    
		}
	], function(err, results) {
		if (err) {
			t.fail(err);
		}
	});
});

test(++testId + ' PagerDuty Broker - Delete Test TIAM Creds', function(t) {
	t.plan(2);
	var tiamHeader = {};
	tiamHeader.Authorization = "Basic " + new Buffer(nconf.get("test-tiam-id") + ":" + nconf.get("test-tiam-secret")).toString('base64');
	
    // Delete a toolchain credentials
    var url = nconf.get("TIAM_URL") + '/service/manage/slack/' + mockServiceInstanceId + "/" + mockToolchainId;
    delRequest(url, {header: tiamHeader})
    .then(function(result) {
    	t.equal(result.statusCode, 204, "toolchain credentials deleted ?");
    	tiamCredentials.toolchain_credentials = null;
    });        		
	// Delete a service credentials
	url = nconf.get("TIAM_URL") + '/service/manage/pagerduty/' + mockServiceInstanceId;
    delRequest(url, {header: tiamHeader})
	    .then(function(result) {
	    	t.equal(result.statusCode, 204, "service credentials deleted ?");
	    	tiamCredentials.service_credentials = null;
	    });        		
});




// Monitoring endpoints
test_(++testId + ' PagerDuty Broker - Test GET status', function (t) {
    t.plan(1);

    var url = nconf.get('url') + '/status';
    getRequest(url, {header: null}).then(function(results) {
    	t.equal(results.statusCode, 200, 'did the get status call succeed?');
    });
});

test_(++testId + ' PagerDuty Broker - Test GET version', function (t) {
    t.plan(1);

    var url = nconf.get('url') + '/version';
    getRequest(url, {header: null}).then(function(results) {
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

function addServiceToDelete(serviceInstanceUrl, serviceInstanceHeaders, dashboardUrl, pagerdutyHeaders, callback) {
	// service instance
	addToDeleteIfAbsent('service_instance', serviceInstanceUrl, serviceInstanceHeaders);
	
	// PagerDuty service
	var index = dashboardUrl.indexOf('/services');
	var apiUrl = dashboardUrl.substring(0, index) + '/api/v1';
	var pagerdutyServiceUrl = apiUrl + dashboardUrl.substring(index);
	addToDeleteIfAbsent('pagerduty_service', pagerdutyServiceUrl, pagerdutyHeaders);
	
	// escalation policy
	request.get({
		uri: pagerdutyServiceUrl+'?include[]=escalation_policy',
		json: true,
		headers: pagerdutyHeaders
	}, function(err, reqRes, body) {
		if (reqRes.statusCode == 200) {
			var escalationPolicyId = body.service.escalation_policy.id;
			var escalationPolicyUrl = apiUrl + '/escalation_policies/' + escalationPolicyId;
			addToDeleteIfAbsent('escalation_policy', escalationPolicyUrl, pagerdutyHeaders); // escalation_rules are deleted along with escalation_policies
			request.get({
				uri: escalationPolicyUrl,
				json: true,
				headers: pagerdutyHeaders
			}, function(err, reqRes, body) {
				// users
				if (reqRes.statusCode == 200) {
					var escalationRules = body.escalation_policy.escalation_rules;
					_.forEach(escalationRules, function(rule) {
						var escalationRuleUrl = escalationPolicyUrl + '/escalation_rules/' + rule.id;
						var targets = rule.targets;
						_.forEach(targets, function(target) {
							if (target.name == 'Primary contact (' + target.email + ')'
									|| target.name == 'Contact (' + target.email + ')') {
								if (target.email != unknownUserEmail) { // do not delete special user
									var userUrl = apiUrl + '/users/' + target.id;
									addToDeleteIfAbsent('user', userUrl, pagerdutyHeaders);
								}
							}
						});
					});
				}
				callback();
			});
		}
	});
}

function addToDeleteIfAbsent(type, url, headers) {
	if (!url)
		return;
	var toDeleteForType = toDelete[type]
	if (!toDeleteForType) {
		toDeleteForType = toDelete[type] = [];
	}
	if (!_.findWhere(toDeleteForType, {url: url})) {
		toDeleteForType[toDeleteForType.length] = {
			url: url,
			headers: headers
		}
	}
}

function removeFromToDelete(type, url) {
	var toDeleteForType = toDelete[type]
	if (!toDeleteForType) {
		return;
	}
	var service = _.findWhere(toDeleteForType, {url: url});
	if (service) {
		toDelete[type] = _.without(toDeleteForType, service);
	}
}

function deleteAllFrom(collections, collectionIndex, types, typeIndex, t) {
	if (typeIndex == types.length) {
		return;
	}
	var type = types[typeIndex];
	var collection = collections[type];
	if (!collection || collectionIndex == collection.length) {
		return deleteAllFrom(collections, 0, types, typeIndex+1, t)
	}
	var object = collection[collectionIndex];
	request.del({
		uri: object.url,
		json: true,
		headers: object.headers
	}, function(err, reqRes, body) {
		if (err) {
			t.fail("Could not delete " + object.url + " error: " + err);
		}
        if (reqRes && reqRes.statusCode != 204) {
        	t.fail("Could not delete " + object.url + " response: " + JSON.stringify(reqRes, null, 2));
        }
        deleteAllFrom(collections, collectionIndex+1, types, typeIndex, t);
	});
}

function assertDashboardAccessible(body, t) {
	var dashboardUrl = body.dashboard_url;
	request.get({
		uri: dashboardUrl,
		json: true,
		headers: {}
	}, function(err, reqRes, body) {
		t.notEqual(reqRes.statusCode, 404, 'did the get dashboard url call succeed?');
		return;
	});
}

function getIncident(pagerdutyServiceId, timeout, callback) {
	var pagerdutyHeaders = {
		'Authorization': 'Token token=' + pagerdutyApiKey
	};
	var url = pagerdutyApiUrl + "/incidents?service=" + encodeURIComponent(pagerdutyServiceId);
	request.get({
		uri: url,
		json: true,
		headers: pagerdutyHeaders
	}, function(err, reqRes, body) {
        if (reqRes.statusCode != 200) {
        	return callback(null, reqRes.statusCode);
        }
    	var foundIncidents = body.incidents;
    	if (foundIncidents.length == 0) {
    		var now = Date.now();
    		if (now < timeout) {
    			// wait 1s and retry
				return setTimeout(function() {
				    getIncident(pagerdutyServiceId, timeout, callback);
				}, 1000);    			
    		} else {
    			return callback(null, "timeout");
    		}
    	}
        var incident = foundIncidents[0];
       	return callback(incident);
	});
}

function resolveIncident(incidentNumber, userEmail, t) {
	var pagerdutyHeaders = {
		'Authorization': 'Token token=' + pagerdutyApiKey
	};
	var userUrl = pagerdutyApiUrl + "/users?query=" + encodeURIComponent(userEmail);
	request.get({
		uri: userUrl,
		json: true,
		headers: pagerdutyHeaders
	}, function(err, reqRes, body) {
        t.equal(reqRes.statusCode, 200, 'was the user retrieved?');
        var userId = body.users[0].id;
		var getIncidentUrl = pagerdutyApiUrl + "/incidents/" + encodeURIComponent(incidentNumber);
		request.get({
			uri: getIncidentUrl,
			json: true,
			headers: pagerdutyHeaders
		}, function(err, reqRes, body) {
			t.equal(reqRes.statusCode, 200, 'was the incident retrieved?');
			var incidentId = body.id;
			var resolveIncidentUrl = pagerdutyApiUrl + "/incidents/" + encodeURIComponent(incidentId) + "/resolve?requester_id=" + userId;
			request.put({
				uri: resolveIncidentUrl,
				json: true,
				headers: pagerdutyHeaders
			}, function(err, reqRes, body) {
				t.equal(reqRes.statusCode, 200, 'was the incident resolved?');
			});	
		});
	});
}

function assertService(pagerduty, t, callback) {
	return assertServiceOnPagerDutySite(pagerdutyApiUrl, pagerdutyApiKey, pagerduty, t, callback);
}

function assertServiceOnPagerDutySite(apiUrl, apiKey, pagerduty, t, callback) {
	var pagerdutyHeaders = {
		'Authorization': 'Token token=' + apiKey
	};
	var url = apiUrl + "/services?query=" + encodeURIComponent(pagerduty.service_name) + "&include[]=escalation_policy";
	request.get({
		uri: url,
		json: true,
		headers: pagerdutyHeaders
	}, function(err, reqRes, body) {
        t.equal(reqRes.statusCode, 200, 'did the get service call succeed?');
    	var foundServices = _.where(body.services, {"name": pagerduty.service_name});
        t.equal(foundServices.length, 1, 'was exactly 1 service found?');
        var service = foundServices[0];
        if (callback)
        	return callback(t, pagerdutyHeaders, service);
        return;
	});
}


// plan == 15 (or 10 for no phone number case)
function assertServiceAndUser(pagerduty, t) {
	return assertServiceAndUserOnPagerDutySite(pagerdutyApiUrl, pagerdutyApiKey, pagerduty, t);
}

function assertServiceAndUserOnPagerDutySite(apiUrl, apiKey, pagerduty, t) {
	assertServiceOnPagerDutySite(apiUrl, apiKey, pagerduty, t, function(t, pagerdutyHeaders, service) {
        var escalation_policy = service.escalation_policy;
        var userName = "Primary contact (" + pagerduty.user_email + ")";
        t.equal(escalation_policy.name, "Policy for " + pagerduty.service_name, 'was the right escalation policy created?');
        var escalation_policy_url = apiUrl + "/escalation_policies/" + escalation_policy.id;
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
			t.equal(target.name, userName, 'was the correct user name used?');
			t.equal(target.email, pagerduty.user_email, 'was the correct user email used?');
			var contact_method_url = apiUrl + "/users/" + target.id + "/contact_methods";
			request.get({
				uri: contact_method_url,
				json: true,
				headers: pagerdutyHeaders
			}, function(err, reqRes, body) {
				t.equal(reqRes.statusCode, 200, 'did the get contact methods call succeed?');
				t.ok(body.contact_methods, 'were contact methods found?');
				if (!pagerduty.user_phone_number) // case where no phone number was provided
					return;
				var phone_contact_method = _.findWhere(body.contact_methods, {"type": "phone", "country_code": Number(pagerduty.user_phone_country), "phone_number": pagerduty.user_phone_number});
				t.ok(phone_contact_method, 'was the phone contact method found (+' + pagerduty.user_phone_country + ' ' + pagerduty.user_phone_number + ')?');
				var sms_contact_method = _.findWhere(body.contact_methods, {"type": "SMS", "country_code": Number(pagerduty.user_phone_country), "phone_number": pagerduty.user_phone_number});
				t.ok(sms_contact_method, 'was the SMS contact method found (+' + pagerduty.user_phone_country + ' ' + pagerduty.user_phone_number + ')?');
				
				// Check the notification rules for SMS and Phone
				var notification_rules_url = apiUrl + "/users/" + target.id + "/notification_rules";
				request.get({
					uri: notification_rules_url,
					json: true,
					headers: pagerdutyHeaders
				}, function(err, reqRes, body) {
					t.equal(reqRes.statusCode, 200, 'did the get notification rules call succeed?');
					t.ok(body.notification_rules, 'were notification rules found?');
					var phone_rule;
					var sms_rule;
					if (body.notification_rules) {
						_.each(body.notification_rules, function(notificationRule) {
							var contact_method = notificationRule.contact_method;
							if (contact_method) {
								if (contact_method.country_code==Number(pagerduty.user_phone_country) && contact_method.phone_number==pagerduty.user_phone_number) {
									if (contact_method.type=="SMS") {
										sms_rule = notificationRule;
									} else if (contact_method.type=="phone")
										phone_rule = notificationRule;
								}
							}						
						});
					}
					t.ok(phone_rule, 'was the Phone Notification rule found (+' + pagerduty.user_phone_country + ' ' + pagerduty.user_phone_number + ')?');					
					t.ok(sms_rule, 'was the SMS Notification rule found (+' + pagerduty.user_phone_country + ' ' + pagerduty.user_phone_number + ')?');
				});
				
			});
    	});
        
	});
}

function getNewInstanceBody(pagerduty) {
	var body = {};
    body.service_id = 'pagerduty';
    body.organization_guid = organization_guid;
    body.parameters = getPostServiceInstanceParameters(pagerduty);
    body.service_credentials = tiamCredentials.service_credentials;
	return body;
}

function getTestPagerDutyInfo() {
	var pagerduty = {};
	pagerduty.service_name = getTestServiceName();
	pagerduty.user_email = getTestUserEmail();
	pagerduty.user_phone_country = '33';
	pagerduty.user_phone_number = "123456789";
	return pagerduty;
}

function getTestUserEmail() {
	return "user" + testNumber + "_" + currentTime + "@ibm.com";
}

function getTestServiceName() {
	return "(" + testNumber + ") Test service " + currentTime;
}

function getPostServiceInstanceParameters(pagerduty) {
	var user_phone;
	if (pagerduty.user_phone_country) {
		user_phone = "+" + pagerduty.user_phone_country + " " + pagerduty.user_phone_number;
	} else if (pagerduty.user_phone_number)
		user_phone = pagerduty.user_phone_number;
	var result = {
		site_name: pagerdutySiteName,
		api_key: pagerdutyApiKey,
		service_name: pagerduty.service_name
	};
	if (pagerduty.user_email)
		result.user_email = pagerduty.user_email;
	if (user_phone)
		result.user_phone = user_phone;
	return result;
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

function patchRequest(url, options) {
    var params = initializeRequestParams(url, options);

    var patch = Q.nbind(request.patch, this);
    return patch(params.uri, {body: params.body, headers: params.headers})
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

function postRequest(url, options) {
    var params = initializeRequestParams(url, options);

    var post = Q.nbind(request.post, this);
    return post(params.uri, {body: params.body, headers: params.headers})
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

function putServiceInstance(serviceInstanceUrl, header, body, callback) {
	putRequest(serviceInstanceUrl, {header: header, body: JSON.stringify(body)}).then(function(results) {
		if (results && results.statusCode == 200) {
			addServiceToDelete(serviceInstanceUrl, header, results.body.dashboard_url, pagerdutyDefaultHeaders, function() {
				callback(results);
			});
			return;
		}
		callback(results);
	});
}
