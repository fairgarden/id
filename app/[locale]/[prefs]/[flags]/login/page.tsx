import { SignIn } from '@fairgarden/id/lib/ui/SignIn'

// Signing in always happens in an OIDC interaction; this page starts one for
// the account page, or goes straight there when already signed in.
export default function Login() {
  return <SignIn />
}
