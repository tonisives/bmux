import { expect, it } from 'vitest'
import { socketAgent } from '../src/main/socket-agent'

it('leaves desktop sockets unchanged without a configured adapter identity', () => {
  let command = { method: 'eval', args: { pane: '%1', expression: '1' } }
  expect(socketAgent(command, undefined)).toBe(command)
})
it('identifies legacy adapter commands without replacing explicit agent context', () => {
  let command = { method: 'eval', args: { pane: '%1', expression: '1' } }
  expect(socketAgent(command, 'tskr-adapter')).toEqual({ ...command, args: { ...command.args, agentId: 'tskr-adapter' } })
  expect(command.args).not.toHaveProperty('agentId')
  let explicit = { method: 'eval', args: { ...command.args, agentId: 'another-agent', agentType: 'worker' } }
  expect(socketAgent(explicit, 'tskr-adapter')).toBe(explicit)
})
it('validates the configured adapter identity', () => {
  expect(() => socketAgent({ method: 'eval' }, 'invalid\nagent')).toThrow('agentId must be nonempty text')
})
