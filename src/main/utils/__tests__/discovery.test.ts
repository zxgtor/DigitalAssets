import { describe, it, expect } from 'vitest'
import {
  enumerateSubnet,
  isComfyResponse,
  buildProbeUrls
} from '../discovery'

describe('enumerateSubnet', () => {
  it('expands a /24 into 254 hosts (skips .0 and .255)', () => {
    const hosts = enumerateSubnet('192.168.1.42', 24)
    expect(hosts.length).toBe(254)
    expect(hosts[0]).toBe('192.168.1.1')
    expect(hosts[253]).toBe('192.168.1.254')
    expect(hosts).not.toContain('192.168.1.0')
    expect(hosts).not.toContain('192.168.1.255')
  })

  it('returns [] when prefix is not /24 (unsupported)', () => {
    expect(enumerateSubnet('10.0.0.5', 16)).toEqual([])
  })
})

describe('buildProbeUrls', () => {
  it('crosses host x portRange', () => {
    expect(buildProbeUrls(['1.2.3.4', '1.2.3.5'], [8188, 8189])).toEqual([
      'http://1.2.3.4:8188',
      'http://1.2.3.4:8189',
      'http://1.2.3.5:8188',
      'http://1.2.3.5:8189'
    ])
  })

  it('skips an "own" url to avoid probing self', () => {
    const urls = buildProbeUrls(['1.2.3.4'], [8188, 8188], { skip: ['http://1.2.3.4:8188'] })
    expect(urls).toEqual([])
  })
})

describe('isComfyResponse', () => {
  it('matches the ComfyUI /system_stats shape', () => {
    expect(isComfyResponse({ system: { os: 'linux' }, devices: [{ name: 'cuda:0' }] })).toBe(true)
  })

  it('rejects arbitrary JSON', () => {
    expect(isComfyResponse({ hello: 'world' })).toBe(false)
    expect(isComfyResponse(null)).toBe(false)
    expect(isComfyResponse('not an object')).toBe(false)
  })
})
