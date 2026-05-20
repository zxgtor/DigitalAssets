import { ipcMain, BrowserWindow } from 'electron'
import { getPool, type Workstation, type Job } from '../services/workstationPool'
import type { WorkflowJSON } from '../services/workflow'
import type { SchedulerMode } from '../store'
import { getSettings, setSettings } from '../store'
import type { DiscoveryCandidate } from '../utils/discovery'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerWorkstationHandlers(): void {
  const pool = getPool()
  pool.on('workstations:update', (list: Workstation[]) => broadcast('workstations:update', list))
  pool.on('jobs:update', (list: Job[]) => broadcast('jobs:update', list))

  // Apply persisted scheduler mode on startup.
  pool.setMode(getSettings().schedulerMode)
  pool.start()

  ipcMain.handle('workstations:list', () => pool.list())

  ipcMain.handle('workstations:add', (_e, input: { name: string; url: string }) => pool.add(input))

  ipcMain.handle('workstations:remove', (_e, id: string) => {
    // Block delete if workstation has active jobs.
    const active = pool.getJobs().some(
      (j) => j.workstationId === id && (j.status === 'pending' || j.status === 'running' || j.status === 'submitting')
    )
    if (active) throw new Error('Workstation has active jobs. Cancel them first.')
    pool.remove(id)
  })

  ipcMain.handle('workstations:edit', (_e, args: { id: string; patch: Partial<{ name: string; url: string; enabled: boolean }> }) => {
    pool.edit(args.id, args.patch)
  })

  ipcMain.handle('workstations:refreshModels', async (_e, id: string) => {
    await pool.refreshModels(id)
  })

  ipcMain.handle('workstations:setMode', (_e, mode: SchedulerMode) => {
    pool.setMode(mode)
    setSettings({ schedulerMode: mode })
  })

  ipcMain.handle('workstations:submit', async (_e, args: { workflow: WorkflowJSON; preferWorkstation?: string }) => {
    return pool.submit({ workflow: args.workflow, hints: { preferWorkstation: args.preferWorkstation } })
  })

  ipcMain.handle('workstations:getJobs', () => pool.getJobs())

  ipcMain.handle('workstations:clearDoneJobs', () => pool.clearDoneJobs())

  ipcMain.handle('workstations:removeJob', (_e, id: string) => pool.removeJob(id))

  ipcMain.handle('workstations:cancel', async (_e, id: string) => {
    const job = pool.getJobs().find((j) => j.id === id)
    if (!job || !job.promptId || !job.workstationId) return
    const ws = pool.list().find((w) => w.id === job.workstationId)
    if (!ws) return
    const { default: axios } = await import('axios')
    try {
      await axios.post(`${ws.url}/interrupt`, {}, { timeout: 3_000 })
    } catch { /* fire-and-forget */ }
  })

  // Discover — streamed via 'workstations:discover:candidate' events while running.
  ipcMain.handle('workstations:discover', async (_e) => {
    const portRange = getSettings().discovery.portRange
    return pool.discoverOnLan({
      portRange,
      onCandidate: (c: DiscoveryCandidate) => broadcast('workstations:discover:candidate', c)
    })
  })

  ipcMain.handle('workstations:testConnection', async (_e, url: string) => {
    const clean = url.trim().replace(/\/$/, '')
    const { default: axios } = await import('axios')
    try {
      const res = await axios.get(`${clean}/system_stats`, { timeout: 3_000 })
      return { ok: true, gpu: res.data?.devices?.[0]?.name ?? 'unknown GPU' }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
