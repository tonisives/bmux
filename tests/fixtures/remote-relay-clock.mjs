let now = Date.now, offset = 0
Date.now = () => now() + offset
process.on('message', message => {
  if (message?.type !== 'clock-offset' || !Number.isFinite(message.offset)) return
  offset = message.offset
  process.send({ type: 'clock-offset', offset })
})
process.channel.unref()
