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
 async = require("async"),
 _ = require("underscore")
;

var logger = log4js.getLogger("pagerduty-broker"),
 	logBasePath = "lib.middleware.pagerduty-utils";

module.exports.getEscalationPolicy = getEscalationPolicy;
module.exports.getUserInfo = getUserInfo;
module.exports.getOrCreatePagerDutyUser = getOrCreatePagerDutyUser;
module.exports.getOrCreateEscalationPolicy = getOrCreateEscalationPolicy;
module.exports.getOrCreatePagerDutyService = getOrCreatePagerDutyService;
module.exports.postAlert = postAlert;

function addPhoneContact(apiUrl, headers, user, phone, type, callback) {
	var logPrefix = "[" + logBasePath + ".addPhoneContact] ";
	var contactMethodUrl = apiUrl + "/users/" + user.id + "/contact_methods";
	request.post({
		uri: contactMethodUrl,
		json: true,
		headers: headers,
		body: {
          contact_method: {
              type: type,
              country_code: phone.country,
              address: phone.number
          }
		}
	}, function(err, reqRes, body) {
		if (handleError(null, err, reqRes, 201, callback, logPrefix + "Creating the contact method '" + type + "' for user_email: " + user.email))
			return;
		return callback(null, body.contact_method);
	});
}

function addNotificationRule(apiUrl, headers, user, contact_method, callback) {
	var logPrefix = "[" + logBasePath + ".addNotificationRule] ";
	var notificationMethodUrl = apiUrl + "/users/" + user.id + "/notification_rules";
	request.post({
		uri: notificationMethodUrl,
		json: true,
		headers: headers,
		body: {
			notification_rule: {
	            contact_method_id: contact_method.id,
	            start_delay_in_minutes: 0
	        }
		}
	}, function(err, reqRes, body) {
		if (handleError(null, err, reqRes, 201, callback, logPrefix + "Creating the notification rule for user_email: " + user.email))
			return;
		return callback(null, body.notification_rule);
	});
}

function getEscalationPolicy(res, apiUrl, api_key, escalation_id, callback) {
	var logPrefix = "[" + logBasePath + ".getEscalationPolicy] ";
	var headers = {
		'Authorization': 'Token token=' + api_key,
		'user-agent': 'node.js'
	};
	var url = apiUrl + "/escalation_policies/" + escalation_id;
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		if (handleError(res, err, reqRes, 200, callback, logPrefix + "Unable to get escalation policy escalation_id: " + escalation_id))
			return;
		return callback(null, body.escalation_policy);
	});
}

function getUser(res, apiUrl, api_key, user_id, callback) {
	if (!user_id) {
		return callback(null, null);
	}
	var logPrefix = "[" + logBasePath + ".getUser] ";
	var headers = {
		'Authorization': 'Token token=' + api_key,
		'user-agent': 'node.js'
	};
	var url = apiUrl + "/users/" + user_id;
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		if (handleError(res, err, reqRes, 200, callback, logPrefix + "Getting the user for user_id: " + user_id ))
			return;
		return callback(null, body.user);
	});
}

function getUserInfo(res, apiUrl, api_key, user_id, callback) {
	var logPrefix = "[" + logBasePath + ".getUserInfo] ";
	var headers = {
		'Authorization': 'Token token=' + api_key,
		'user-agent': 'node.js'
	};
	var url = apiUrl + "/users/" + user_id + "/contact_methods";
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		if (handleError(res, err, reqRes, 200, callback, logPrefix + "Getting contact methods for user_id: " + user_id ))
			return;
		var email, phone;
		var contact_methods = body.contact_methods;
		if (contact_methods) {
			for (var i=0; i < contact_methods.length; i++) {
				var contact_method = contact_methods[i];
				if (contact_method.type == "email") {
					email = contact_method.email
				} else if (contact_method.type == "phone") {
					phone = "+" + contact_method.country_code + " " + contact_method.phone_number;
				}
			}
		}
		return callback(null, email, phone);
	});
}
			
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

function getOrCreatePagerDutyUser(res, apiUrl, api_key, userName, user_email, user_phone, callback) {
	var logPrefix = "[" + logBasePath + ".getOrCreatePagerDutyUser] ";
	var headers = {
		'Authorization': 'Token token=' + api_key,
		'user-agent': 'node.js'
	};
		
	if (user_email) {
		user_email = user_email.trim();
	}
	// Check if the user account exists
	var url = apiUrl + "/users?query=" + encodeURIComponent(user_email) + "&include[]=contact_methods&include[]=notification_rules";
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		if (handleError(res, err, reqRes, 200, callback, logPrefix + "Verifying if the user account already exists for user user_email: " + user_email))
			return;
		
		var user;
		if (body.users) {
			// Search for right user account
			for (var i=0; i < body.users.length; i++) {
				var found = body.users[i];
				if (found.email == user_email) {
					user = found;
				}
			}
		}
			
		if(user) {
			// Ensure phone and SMS are contact methods and notification rules are in place with hig
			var phone = toPhoneNumberAndCountry(user_phone);
			if (!phone) {
				return callback(null, user);
			}
			// is there a phone contact ?
			var phone_contact;
			var sms_contact;
			if (user.contact_methods) {
				phone_contact = _.findWhere(user.contact_methods, {"type": "phone", "country_code": phone.country, "phone_number": phone.number});
				sms_contact = _.findWhere(user.contact_methods, {"type": "SMS", "country_code": phone.country, "phone_number": phone.number});
			}
			
			// is there sms and phone notification rule ?
			var phone_rule;
			var sms_rule;
			if (user.notification_rules) {
				_.each(user.notification_rules, function(notificationRule) {
					if (notificationRule.urgency == "high") {
						var contact_method = notificationRule.contact_method;
						if (contact_method) {
							if (contact_method.country_code==phone.country && contact_method.phone_number==phone.number) {
								if (contact_method.type=="SMS") {
									sms_rule = notificationRule;
								} else if (contact_method.type=="phone")
									phone_rule = notificationRule;
							}
						}						
					}
				});
			}
			
			async.auto({
				phone_contact: function(asyncCallback) {
					if (!phone_contact) {
						addPhoneContact(apiUrl, headers, user, phone, "phone", asyncCallback);
					} else {
						asyncCallback(null, phone_contact);
					} 
				},
				sms_contact: function(asyncCallback) {
					if (!sms_contact) {
						addPhoneContact(apiUrl, headers, user, phone, "SMS", asyncCallback);
					} else {
						asyncCallback(null, sms_contact);
					}
				},
				phone_rule: ["phone_contact", function(asyncCallback, results) {
					if (!phone_rule) {
						addNotificationRule(apiUrl, headers, user, results.phone_contact, asyncCallback);
					} else {
						asyncCallback(null, phone_rule);								
					}
				}],
				sms_rule: ["sms_contact", function(asyncCallback, results) {
					if (!sms_rule) {
						addNotificationRule(apiUrl, headers, user, results.sms_contact, asyncCallback);
					} else {
						asyncCallback(null, sms_rule);								
					}
				}]
			}, function(err, results) {
				if (err) {
					logger.error(logPrefix + "Error while adding contacts and notification rules: " + err);
					if (res) {
						res.status(400).json({ "description": err });
					}
					return callback(err, null);
				} else {
					return callback(null, user);
				}
			});
		} else {				
			// Create user account
			var url = apiUrl + "/users";
			request.post({
				uri: url,
				json: true,
				headers: headers,
				body: {
					user: {
						name: userName,
						email: user_email
					}
				}
			}, function(err, reqRes, body) {
				if (handleError(res, err, reqRes, 201, callback, logPrefix + "Creating the PagerDuty user for user user_email: " + user_email))
					return;

				// Create contact methods (phone and SMS) with given user_phone
				var phone = toPhoneNumberAndCountry(user_phone);
				var user = body.user;
				if (!phone) {
					return callback(null, user);
				}
				async.auto({
					phone_contact: function(asyncCallback) {
						addPhoneContact(apiUrl, headers, user, phone, "phone", asyncCallback);
					},
					sms_contact: function(asyncCallback) {
						addPhoneContact(apiUrl, headers, user, phone, "SMS", asyncCallback);						
					},
					phone_rule: ["phone_contact", function(asyncCallback, results) {
						addNotificationRule(apiUrl, headers, user, results.phone_contact, asyncCallback);
					}],
					sms_rule: ["sms_contact", function(asyncCallback, results) {
						addNotificationRule(apiUrl, headers, user, results.sms_contact, asyncCallback);
					}]
				}, function(err) {
					if (err) {
						logger.error(logPrefix + "Error while adding contacts and notification rules: " + err);
						if (res) {
							res.status(400).json({ "description": err });						
						}
						return callback(err, null);
					} else {
						return callback(null, user);
					}
				});
			});
		}
	});
}

function getOrCreateEscalationPolicy(res, apiUrl, api_key, service_name, user_email, user_phone, callback) {
	var logPrefix = "[" + logBasePath + ".getOrCreateEscalationPolicy] ";
	var headers = {
		'Authorization': 'Token token=' + api_key,
		'user-agent': 'node.js'
	};
	var userName = "Primary contact (" + user_email + ")";
	var escalation_name = "Policy for " + service_name;
			
	// Check if the escalation policy exists
	// remove the leading and trailing blank that are not stored in PagerDuty server
	if (escalation_name) {
		escalation_name = escalation_name.trim();
	}
	logger.debug(logPrefix + "Checking if escalation policy '" + escalation_name + "' exists");
	
	var url = apiUrl + "/escalation_policies?query=" + encodeURIComponent(escalation_name);
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		if (handleError(res, err, reqRes, 200, callback, logPrefix + "Verifying if the escalation policy already exists for user: " + userName))
			return;
		
		var escalation_policy;
		if (body.escalation_policies) {
			// Search for right escalation policy
			for (var i=0; i < body.escalation_policies.length; i++) {
				var found = body.escalation_policies[i];
				if (found.name == escalation_name) {
					escalation_policy = found;
				}
			}
		}
			
		if(escalation_policy) {
			logger.debug(logPrefix + "Escalation policy found: " + escalation_policy.id);
			return callback(null, escalation_policy);
		} else {
			getOrCreatePagerDutyUser(res, apiUrl, api_key, userName, user_email, user_phone, function(err, user) {
				if (err)
					return callback(err, null);
				// Create escalation policy
				logger.debug(logPrefix + "No escalation policy '" + escalation_name + "' found. Starting the creation of it");
				var url = apiUrl + "/escalation_policies";
				request.post({
					uri: url,
					json: true,
					headers: headers,
					body: {
						escalation_policy: {
						    name: escalation_name,
						    escalation_rules: [{
						        escalation_delay_in_minutes: 30,
						        targets: [{
						            type: "user",
						            id: user.id
						        }]
						    }]
						}
					}
				}, function(err, reqRes, body) {
					if (handleError(res, err, reqRes, 201, callback, logPrefix + "Creating the PagerDuty escalation policy for user: " + userName))
						return;
					return callback(null, body.escalation_policy);
				});
			});
		}
	});
}


function getOrCreatePagerDutyService(res, apiUrl, api_key, account_id, service_name, user_email, user_phone, patching, callback) {
	var logPrefix = "[" + logBasePath + ".getOrCreatePagerDutyService] ";
	var headers = {
		'Authorization': 'Token token=' + api_key,
		'user-agent': 'node.js'
	};
			
	if (service_name) {
		service_name = service_name.trim();
	}
	// Check if the service exists
	var url = apiUrl + "/services?query=" + encodeURIComponent(service_name)+"&include[]=escalation_policy";
	request.get({
		uri: url,
		json: true,
		headers: headers
	}, function(err, reqRes, body) {
		if (err && err.code == "ENOTFOUND") { // special error handling for invalid account id case
			var message = "Invalid account_id: " + account_id;
			logger.debug(logPrefix + message);
			res.status(400).json({ "description": message });
			return callback(message, null);
		}
		if (handleError(res, err, reqRes, 200, callback, logPrefix + "Verifying if the PagerDuty service already exists for service_name: " + service_name, function(statusCode, errorMessage) {
			if (statusCode == 401/*invalid api_key*/ || statusCode == 404/*unknown account_id*/) 
				statusCode = 400/*make it a bad request*/;
			res.status(statusCode).json({ "description": errorMessage });
		}))
			return;
		
		var service;
		if (body.services) {
			// Search for right service
			for (var i=0; i < body.services.length; i++) {
				var found = body.services[i];
				if (found.name == service_name) {
					service = found;
				}
			}
		}
			
		if(service) {
			if (user_email || user_phone) {
				// ensure email and phone are correct
				return getEscalationPolicy(res, apiUrl, api_key, service.escalation_policy.id, function(err, escalationPolicy) {
					if (err)
						return callback(err, null);
					var userId = escalationPolicy.escalation_rules[0].targets[0].id;
					getUserInfo(res, apiUrl, api_key, userId, function(err, email, phone) {
						if (err)
							return callback(err, null);
						if (user_email != email || user_phone != phone) {
							return updateEscalationPolicy(res, apiUrl, api_key, service.escalation_policy.id, escalationPolicy.escalation_rules, user_email, user_phone, patching, function(err, escalation_policy) {
								if (err) 
									return callback(err, null);
								return callback(null, service);
							});
						}
						return callback(null, service);
					});
				});				
			}
			return callback(null, service);
		} else {
			getOrCreateEscalationPolicy(res, apiUrl, api_key, service_name, user_email, user_phone, function(err, escalation_policy) {
				if (err)
					return callback(err, null);
				// Create a PagerDuty service
				var url = apiUrl + "/services";
				request.post({
					uri: url,
					json: true,
					headers: headers,
					body: {
						service: {
						    name: service_name,
						    escalation_policy_id: escalation_policy.id,
						    type: "generic_events_api"
						}
					}
				}, function(err, reqRes, body) {
					if (handleError(res, err, reqRes, 201, callback, logPrefix + "Creating the PagerDuty service for service_name: " + service_name))
						return;
					return callback(null, body.service);
				});
			});
		}
	});
}

function handleError(res, err, reqRes, expectedStatusCode, callback, logMessage, unexpectedStatusCodeHandler) {
	if (err) {
		logger.error(logMessage + " failed with the following error from PagerDuty: " + JSON.stringify(err, null, 2));
		if (res) {
			res.status(500).json({ "description": JSON.stringify(err) });
		}
		callback(err);
		return true;
	} else if(reqRes && reqRes.statusCode != expectedStatusCode) {
		logger.error(logMessage + " failed [" + reqRes.statusCode + "] with the following error from PagerDuty: " + JSON.stringify(reqRes, null, 2));
		var errorMessage = getErrorMessageFromResult(reqRes);
		if (res) {
			if (unexpectedStatusCodeHandler) {
				unexpectedStatusCodeHandler(reqRes.statusCode, errorMessage);
			} else {
				res.status(reqRes.statusCode).json({ "description": errorMessage });
			}
		}
		callback(errorMessage);
		return true;
	}
	return false;
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
		if (handleError(null, err, reqRes, 200, callback, logPrefix + "Posting a PagerDuty alert for service_key: " + service_key))
			return;
		return callback(null, body);
	});
	
}

function updateEscalationPolicy(res, apiUrl, api_key, escalation_id, escalation_rules, user_email, user_phone, updateUser, callback) {
	var logPrefix = "[" + logBasePath + ".updateEscalationPolicy] ";
	var headers = {
		'Authorization': 'Token token=' + api_key,
		'user-agent': 'node.js'
	};
	logger.debug(logPrefix + "Updating the PagerDuty escalation policy '" + escalation_id + "'for user with"
			+ " user_email: " + user_email);
	
	var userName = "Primary contact (" + user_email + ")";
	getOrCreatePagerDutyUser(res, apiUrl, api_key, userName, user_email, user_phone, function(err, user) {
		if (err)
			return callback(err, null);
		
		var previousPrimaryContactId;
		var previousPrimaryContactTargets = escalation_rules[0].targets;
		if (previousPrimaryContactTargets && previousPrimaryContactTargets.length > 0) {
			previousPrimaryContactId = previousPrimaryContactTargets[0].id;
		}
		getUser(res, apiUrl, api_key, previousPrimaryContactId,  function(err, primaryUser) {
			if (err) {
				return callback(err, null);
			}

			var isOwnContact = primaryUser ? (primaryUser.name == "Primary contact (" + primaryUser.email + ")") : false;
			if (updateUser && !isOwnContact) {
				updateUser = false; // don't update the user if we don't own it
			}
		
			// Update escalation rules
			if (updateUser) {
				// update first escalation rule with new user
				escalation_rules.splice(0, 0, {
			        escalation_delay_in_minutes: 30,
			        targets: [{
			            type: "user",
			            id: user.id
			        }]
				});
				escalation_rules[1] = null; // just updating escalation_rules[0] causes a 500 on PagerDuty
			} else {
				// insert new escalation rule first, keeping existing ones
				escalation_rules.splice(0, 0, {
			        escalation_delay_in_minutes: 30,
			        targets: [{
			            type: "user",
			            id: user.id
			        }]
				});
			}
			
			// Update escalation policy
			var url = apiUrl + "/escalation_policies/" + escalation_id;
			request.put({
				uri: url,
				json: true,
				headers: headers,
				body: {
				    escalation_rules: escalation_rules
				}
			}, function(err, reqRes, body) {
				if (handleError(res, err, reqRes, 200, callback, logPrefix + "Updating the PagerDuty escalation policy for user: " + userName))
					return;
				
				if (isOwnContact && !updateUser) {
					// new user is being inserted, rename previous 'Primary contact'
					var userUrl = apiUrl + "/users/" + previousPrimaryContactId;
					request.put({
						uri: userUrl,
						json: true,
						headers: headers,
						body: {
						    name: "Contact (" + primaryUser.email + ")"
						}
					}, function(err, reqRes, body) {
						if (handleError(res, err, reqRes, 200, callback, logPrefix + "Updating the user name for user with user_email: " + user.email))
							return;
					});
				}
				
				return callback(null, body.escalation_policy);
			});
		});
	});
}


/* Simple transformation of phone numbers like "+1 555 123 4567" into
 * {
 *   country: 1,
 *   number: 5551234567
 * }
 * Remove the non numeric characters in the number (i.e. 613-286-5153 => 6132865153)
 * TODO: check for syntax errors in phone number
 */
function toPhoneNumberAndCountry(str) {
	if (!str) {
		return;
	}
	var arr = str.split(' ');
	if (arr.length == 1) {
		return {
			country: 1,
			number: str.replace(/[^0-9]/g, "")
		}
	}
	var country = arr[0];
	if (country[0] == '+') {
		return {
			country: Number(country.substring(1, country.length)),
			number: concat(arr, 1).replace(/[^0-9]/g, "")
		}
	} else {
		return {
			country: 1,
			number: concat(arr, 0).replace(/[^0-9]/g, "")
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
