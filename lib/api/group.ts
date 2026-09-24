/**
 * The REST API's group and version, Kubernetes style. Resources are served
 * the way Kubernetes serves its core API, at
 * `/api/<version>/<resource>[/<name>[/<subresource>]]`, one route file each
 * under `app/api/`. Every object names its group in `apiVersion`, since some —
 * a `ClaimsReview` — travel between services.
 *
 * The group names the software, not the deployment, so it stays the same
 * however the service is branded. The version is `v1alpha1` while the API
 * may still change without notice; it becomes `v1beta1`, then `v1`, as
 * Kubernetes versions an API on its way to stable.
 */
export const API_GROUP = 'id.fairgarden.org'
export const API_VERSION = 'v1alpha1'
export const GROUP_VERSION = `${API_GROUP}/${API_VERSION}` as const

/** The path of a resource, below wherever the app is mounted. */
export const resourcePath = (mount: string, path = ''): string =>
  `${mount}/api/${API_VERSION}${path ? `/${path}` : ''}`
