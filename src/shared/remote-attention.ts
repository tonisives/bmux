export type RemoteAttentionStatus = 'pending' | 'verifying' | 'resolved' | 'cancelled' | 'expired'
export type RemoteVerificationOutcome = 'verified' | 'verification-failed' | 'verification-timeout'
export type RemoteAttentionAttempt = { id: string; request: string; acknowledgedAt: number; completedAt?: number; outcome?: RemoteVerificationOutcome; code?: string }
export type RemoteAttention = {
  id: string
  revision: number
  host: string
  generation: string
  session: string
  pane: string
  episode: string
  reason: 'help' | 'challenge' | 'account-warning' | 'rate-limit'
  status: RemoteAttentionStatus
  resolved: boolean
  online: boolean
  createdAt: string
  attempt?: RemoteAttentionAttempt
  readAt?: string
  dismissedAt?: string
}
export type RemoteAttentionPage = { items: RemoteAttention[]; nextCursor: string | null }
export type RemoteResumeRequest = { type: 'resume'; generation: number; episode: string; request: string; revision: number }
export type RemoteResumeAcknowledgement = { resumed: true; status: 'verifying'; episode: string; revision: number; attemptId: string; acknowledgedAt: number }
export type RemoteAttentionVerification = { episode: string; attemptId: string; outcome: 'verified' | 'verification-failed'; code?: string }
