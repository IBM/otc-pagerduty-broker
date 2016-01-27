/**
 * Licensed Materials - Property of IBM
 * (c) Copyright IBM Corporation 2015. All Rights Reserved.
 *
 * Note to U.S. Government Users Restricted Rights:
 * Use, duplication or disclosure restricted by GSA ADP Schedule
 * Contract with IBM Corp.
 */
"use strict";

var
 log4js = require("log4js"),
 nanoDocUpdater = require("nano-doc-updater"),
 nconf = require("nconf"),
 request = require("request"),
 _ = require("underscore")
;

var logger = log4js.getLogger("otc-pagerduty-broker"),
 	logBasePath = "lib.middleware.pagerduty-utils";

module.exports.getOrCreatePagerDutyUser = getOrCreatePagerDutyUser;
module.exports.getOrCreateEscalationPolicy = getOrCreateEscalationPolicy;
module.exports.getOrCreatePagerDutyService = getOrCreatePagerDutyService;
module.exports.postAlert = postAlert;

function getErrorMessageFromResult(reqRes) {
	if (reqRes.body) {
		var message = geErrorMessageFromError(reqRes.body);
		if (message)
			return message;
	} 
	return reqRes.statusMessage;
}

function geErrorMessageFromError(error) {
	if (error.errors) {
		var message =  geErrorMessageFromError(error.errors[0]);
		if (message)
			return message;
	}
	if (error.error) {
		var message =  geErrorMessageFromError(error.error);
		if (message)
			return message;
	}
	if (error.message)
		return error.message;
	return error;
}

function getOrCreatePagerDutyUser(res, apiUrl, api_token, userName, user_email, user_phone, callback) {
	var logPrefix = "[" + logBasePath + ".getOrCreatePagerDutyUser] ";
	var headers = {
		'Authorization': 'Token token=' + api_token,
		'user-agent': 'node.js'
	};
		
	// Check if the user account exists
	var url = apiUrl + "/users?query=" + encodeURIComponent(user_email);
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		var user;
		if (err) {
			logger.error(logPrefix + "Unable to verify if the user account already exists for user"
					+ " user_email: " + user_email 
					+ " failed with the following error: " + JSON.stringify(err));
			res.status(500).json({ "description": JSON.stringify(err) });
			return callback(null);
		} else if(reqRes.statusCode == 200 && body.users) {
			// Search for right user account
			for (var i=0; i < body.users.length; i++) {
				var found = body.users[i];
				if (found.email == user_email) {
					user = found;
				}
			}
		} else if(reqRes.statusCode != 404) {
			// Unexpected error that is not 404 nor 200
			var message = getErrorMessageFromResult(reqRes);
			logger.error(logPrefix + "Unexpected error while verifying if the user account already exists for user"
					+ " user_email: " + user_email 
					+ " failed with the following error: " + message);
			res.status(500).json({ "description": JSON.stringify(reqRes) });
			return callback(null);
		}
			
		if(user) {
			// TODO: ensure user_phone is the one requested
			return callback(user);
		} else {				
			// Create user account
			var url = apiUrl + "/users";
			request.post({
				uri: url,
				json: true,
				headers: headers,
				body: {
					name: userName,
					email: user_email
				}
			}, function(err, reqRes, body) {
				if (err) {
					logger.error(logPrefix + "Creating the PagerDuty user for"
							+ " user_email: " + user_email 
							+ " failed with the following error: " + JSON.stringify(err));
					res.status(500).json({ "description": JSON.stringify(err) });
					return callback(null);
				} else if(reqRes && reqRes.statusCode != 201) {
					var message = getErrorMessageFromResult(reqRes);
					logger.error(logPrefix + "Creating the PagerDuty user for"
							+ " user_email: " + user_email 
							+ " failed with the following error: " + message);
					res.status(500).json({ "description": JSON.stringify(reqRes) });
					return callback(null);
				}
				// Create contact method with given user_phone
				var user = body.user;
				var contactMethodUrl = apiUrl + "/users/" + user.id + "/contact_methods";
				var phone = toPhoneNumberAndCountry(user_phone);
				request.post({
					uri: contactMethodUrl,
					json: true,
					headers: headers,
					body: {
			          contact_method: {
			              type: "phone",
			              country_code: phone.country,
			              address: phone.number
			          }
					}
				}, function(err, reqRes, body) {
					if (err) {
						logger.error(logPrefix + "Creating the contact method for"
								+ " user_email: " + user_email 
								+ " failed with the following error: " + JSON.stringify(err));
						res.status(500).json({ "description": JSON.stringify(err) });
						return callback(null);
					} else if(reqRes && reqRes.statusCode != 201) {
						var message = getErrorMessageFromResult(reqRes);
						logger.error(logPrefix + "Creating the contact method for"
								+ " user_email: " + user_email 
								+ " failed with the following error: " + message);
						res.status(500).json({ "description": JSON.stringify(reqRes) });
						return callback(null);
					}
					return callback(user);
				});
			});
		}
	});
}

function getOrCreateEscalationPolicy(res, apiUrl, api_token, user_email, user_phone, callback) {
	var logPrefix = "[" + logBasePath + ".getOrCreateEscalationPolicy] ";
	var headers = {
		'Authorization': 'Token token=' + api_token,
		'user-agent': 'node.js'
	};
	var userName = "Primary contact (" + user_email + ")";
	var escalation_name = "Call " + userName;
			
	// Check if the escalation policy exists
	var url = apiUrl + "/escalation_policies?query=" + encodeURIComponent(escalation_name);
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		var escalation_policy;
		if (err) {
			logger.error(logPrefix + "Unable to verify if the escalation policy already exists for user"
					+ " user_name: " + user_name 
					+ " failed with the following error: " + JSON.stringify(err));
			res.status(500).json({ "description": JSON.stringify(err) });
			return callback(null);
		} else if(reqRes.statusCode == 200 && body.escalation_policies) {
			// Search for right escalation policy
			for (var i=0; i < body.escalation_policies.length; i++) {
				var found = body.escalation_policies[i];
				if (found.name == escalation_name) {
					escalation_policy = found;
				}
			}
		} else if(reqRes.statusCode != 404) {
			// Unexpected error that is not 404 nor 200
			var message = getErrorMessageFromResult(reqRes);
			logger.error(logPrefix + "Unexpected error while verifying if the escalation policy already exists for user"
					+ " user_name: " + user_name 
					+ " failed with the following error: " + message);
			res.status(500).json({ "description": JSON.stringify(reqRes) });
			return callback(null);
		}
			
		if(escalation_policy) {
			return callback(escalation_policy);
		} else {
			getOrCreatePagerDutyUser(res, apiUrl, api_token, userName, user_email, user_phone, function(user) {
				if (!user)
					return callback(null);
				// Create escalation policy
				var url = apiUrl + "/escalation_policies";
				request.post({
					uri: url,
					json: true,
					headers: headers,
					body: {
					    name: escalation_name,
					    escalation_rules: [{
					        escalation_delay_in_minutes: 30,
					        targets: [{
					            type: "user",
					            id: user.id
					        }]
					    }]
					}
				}, function(err, reqRes, body) {
					if (err) {
						logger.error(logPrefix + "Creating the PagerDuty escalation policy for user with"
								+ " user_name: " + user_name 
								+ " failed with the following error: " + JSON.stringify(err));
						res.status(500).json({ "description": JSON.stringify(err) });
						callback(null)
					} else if(reqRes && reqRes.statusCode != 201) {
						var message = getErrorMessageFromResult(reqRes);
						logger.error(logPrefix + "Creating the PagerDuty escaltaion policy for user with"
								+ " user_name: " + user_name 
								+ " failed with the following error: " + message);
						res.status(500).json({ "description": JSON.stringify(reqRes) });
						callback(null)
					}
					
					return callback(body.escalation_policy);
				});
			});
		}
	});
}


function getOrCreatePagerDutyService(res, apiUrl, api_token, service_name, user_email, user_phone, callback) {
	var logPrefix = "[" + logBasePath + ".getOrCreatePagerDutyService] ";
	var headers = {
		'Authorization': 'Token token=' + api_token,
		'user-agent': 'node.js'
	};
			
	// Check if the service exists
	var url = apiUrl + "/services?query=" + encodeURIComponent(service_name);
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		var service;
		if (err) {
			logger.error(logPrefix + "Unable to verify if the PagerDuty service already exists for"
					+ " service_name: " + service_name 
					+ " failed with the following error: " + JSON.stringify(err));
			res.status(500).json({ "description": JSON.stringify(err) });
			return callback(null);
		} else if(reqRes.statusCode == 200 && body.services) {
			// Search for right service
			for (var i=0; i < body.services.length; i++) {
				var found = body.services[i];
				if (found.name == service_name) {
					service = found;
				}
			}
		} else if(reqRes.statusCode != 404) {
			// Unexpected error that is not 404 nor 200
			var message = getErrorMessageFromResult(reqRes);
			logger.error(logPrefix + "Unexpected error while verifying if the PagerDuty service already exists for"
					+ " service_name: " + service_name 
					+ " failed with the following error: " + message);
			res.status(500).json({ "description": JSON.stringify(reqRes) });
			return callback(null);
		}
			
		if(service) {
			return callback(service);
		} else {
			getOrCreateEscalationPolicy(res, apiUrl, api_token, user_email, user_phone, function(escalation_policy) {
				if (!escalation_policy)
					return callback(null);
				// Create a PagerDuty service
				var url = apiUrl + "/services";
				request.post({
					uri: url,
					json: true,
					headers: headers,
					body: {
					    name: service_name,
					    escalation_policy_id: escalation_policy.id,
					    type: "generic_events_api"
					}
				}, function(err, reqRes, body) {
					if (err) {
						logger.error(logPrefix + "Creating the PagerDuty service for"
								+ " service_name: " + service_name 
								+ " failed with the following error: " + JSON.stringify(err));
						res.status(500).json({ "description": JSON.stringify(err) });
						return callback(null);
					} else if(reqRes && reqRes.statusCode != 201) {
						var message = getErrorMessageFromResult(reqRes);
						logger.error(logPrefix + "Creating the PagerDuty service for"
								+ " service_name: " + service_name 
								+ " failed with the following error: " + message);
						res.status(500).json({ "description": JSON.stringify(reqRes) });
						return callback(null);
					}
					return callback(body.service);
				});
			});
		}
	});
}

function postAlert(logPrefix, service_key, description, callback) {
	var url = "https://events.pagerduty.com/generic/2010-04-15/create_event.json";
	request.post({
		uri: url,
		json: true,
		headers: {},
		body: {
			service_key: service_key,
		    event_type: "trigger",
		    description: description
		}
	}, function(err, reqRes, body) {
		if (err) {
			logger.error(logPrefix + "Posting a PagerDuty alert for"
					+ " service_key: " + service_key 
					+ " failed with the following error: " + JSON.stringify(err));
			return callback(err);
		} else if(reqRes && reqRes.statusCode != 200) {
			var message = getErrorMessageFromResult(reqRes);
			logger.error(logPrefix + "Posting a PagerDuty alert for"
					+ " service_key: " + service_key 
					+ " failed with the following error: " + message);
			return callback(message);
		}
		return callback(null, body);
	});
	
}


/* Simple transformation of phone numbers like "+1 555 123 4567" into
 * {
 *   country: 1,
 *   number: 5551234567
 * }
 * TODO: check for syntax errors in phone number
 */
function toPhoneNumberAndCountry(str) {
	var arr = str.split(' ');
	if (arr.length == 1) {
		return {
			country: 1,
			number: str
		}
	}
	var country = arr[0];
	if (country[0] == '+') {
		return {
			country: Number(country.substring(1, country.length)),
			number: concat(arr, 1)
		}
	} else {
		return {
			country: 1,
			number: concat(arr, 0)
		}
	}
}

function concat(arr, start) {
	var result = "";
	for (var i=start; i < arr.length; i++) {
		result += arr[i];
	}
	return result;
}
