# An organization's rules on sharing: the Example Club's privacy policy, as
# policy. Not id's own rules — an example of what an organization writes in
# its own policies/, in id's package, adding to what id asks.
#
#   fg-policy build --base apps/id/policies --dir apps/id/examples/privacy
package fairgarden.id

import rego.v1

# Where members live is for the membership secretary, and nobody else.
withheld["residential_address"] := "Only Members may ask where you live." if {
	"residential_address" in input.scopes
	input.client.id != "members"
}
