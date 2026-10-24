// The hosted auth service supplies this adapter; bearer issuance belongs to that service.
export let signIn = async (): Promise<void> => { throw new Error('Native sign-in is awaiting the hosted account service.') }
export let signOut = async (): Promise<void> => {}
