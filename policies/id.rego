# METADATA
# title: Your account
# description: >-
#   Who may see and change an account, and what each service may be offered
#   from it when you sign in.
package fairgarden.id

import rego.v1

# The id service's decisions, as it ships them: the questions it asks, what
# it asks them with, and places for an organization's own rules. As shipped
# they decide what id's built-in rules do.
#
# An organization builds its policy on top (fg-dist policy build), writing
# its own rules in its own files in this package, where they add to these:
#
#   deny contains <reason>          refuse a request these rules allow
#   withheld[<scope>] := <reason>   keep a scope from a service, saying why
#
# Upgrading id brings this file's changes and keeps the organization's.
# examples/privacy is an organization's rules on sharing, to start from.

# `authz` is asked of every request to the id service's API.
#
# input.user      {name, authenticated}  name is the account ID, or null
# input.verb      get | list | create | update | patch | delete | deletecollection
# input.resource  {group, version, resource, subresource?, name?, owner?}
#                 owner is whose object it is, where it belongs to someone
#
# The attributes are a Kubernetes SubjectAccessReview's.

# METADATA
# title: Who may see and change an account
# description: >-
#   Only you can see or change your account, your passkeys and the services
#   you share with.
# entrypoint: true
default authz := {"allow": false, "reason": "Sign in first."}

authz := {"allow": false, "reason": concat(" ", sort(deny))} if {
	count(deny) > 0
} else := {"allow": true} if {
	allowed
} else := {"allow": false, "reason": "That belongs to someone else."} if {
	input.user.authenticated
	input.resource.owner != input.user.name
}

# Anyone may ask who they are, and read the mock mailbox (local only).
allowed if input.resource.resource in {"sessions", "mockmessages"}

allowed if {
	input.user.authenticated
	not input.resource.owner
}

allowed if {
	input.user.authenticated
	input.resource.owner == input.user.name
}

# Nothing, until an organization adds to it.
deny contains reason if {
	false
	reason := ""
}

# `release` is asked when a service asks for your information: which of the
# scopes it asked for it may be offered at all, and why not the others. You
# still decide among what is offered, and are shown each reason. `openid` is
# always allowed.
#
# input.user     {name}
# input.client   {id, name}
# input.scopes   the scopes asked for
# input.purpose  Preview (the consent screen is shown) | Consent (the answer is recorded)

# METADATA
# title: What a service may ask you for
# description: >-
#   A service is offered everything it asks for, except what is withheld
#   from it here, with the reason. You choose what to share from what is
#   offered.
# entrypoint: true
release := {
	"scopes": [scope | some scope in input.scopes; not scope in object.keys(withheld)],
	"reasons": withheld,
}

# Nothing, until an organization adds to it.
withheld[scope] := reason if {
	false
	scope := ""
	reason := ""
}
