package fairgarden.id.privacy_test

import data.fairgarden.id
import rego.v1

asked_by(client) := {"user": {"name": "a"}, "client": {"id": client, "name": client}, "scopes": ["openid", "residential_address"]}

test_only_members_may_ask_where_you_live if {
	events := id.release with input as asked_by("events")
	events.scopes == ["openid"]
	events.reasons == {"residential_address": "Only Members may ask where you live."}

	members := id.release with input as asked_by("members")
	members.scopes == ["openid", "residential_address"]
}
