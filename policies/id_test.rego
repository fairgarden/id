package fairgarden.id_test

import data.fairgarden.id
import rego.v1

passkeys(owner) := {"group": "id.fairgarden.org", "version": "v1alpha1", "resource": "passkeys", "owner": owner}

signed_in(name) := {"name": name, "authenticated": true}

test_anyone_may_ask_who_they_are if {
	id.authz.allow with input as {
		"user": {"name": null, "authenticated": false},
		"verb": "get",
		"resource": {"group": "id.fairgarden.org", "version": "v1alpha1", "resource": "sessions", "name": "current"},
	}
}

test_signing_in_comes_first if {
	not id.authz.allow with input as {"user": {"name": null, "authenticated": false}, "verb": "list", "resource": passkeys("a")}
}

test_people_manage_their_own_things if {
	id.authz.allow with input as {"user": signed_in("a"), "verb": "list", "resource": passkeys("a")}
}

test_not_someone_elses if {
	decision := id.authz with input as {"user": signed_in("b"), "verb": "list", "resource": passkeys("a")}
	not decision.allow
	decision.reason == "That belongs to someone else."
}

test_every_scope_is_offered_by_default if {
	decision := id.release with input as {"user": {"name": "a"}, "client": {"id": "events", "name": "Events"}, "scopes": ["openid", "phone"]}
	decision.scopes == ["openid", "phone"]
	decision.reasons == {}
}

# The extension points, filled in as an organization's rules would.

test_a_request_denied_is_refused_and_explained if {
	decision := id.authz with input as {"user": signed_in("a"), "verb": "delete", "resource": passkeys("a")}
		with id.deny as {"Passkeys cannot be removed today."}
	not decision.allow
	decision.reason == "Passkeys cannot be removed today."
}

test_a_scope_withheld_is_not_offered_and_explained if {
	decision := id.release with input as {"user": {"name": "a"}, "client": {"id": "events"}, "scopes": ["openid", "phone"]}
		with id.withheld as {"phone": "Phone numbers stay here."}
	decision.scopes == ["openid"]
	decision.reasons == {"phone": "Phone numbers stay here."}
}
