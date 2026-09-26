import { z } from 'zod';
import { callHomeAssistantApi, type DeviceState } from '../internet-of-things/tools.js';

/**
 * Renders a handful of known devices, with only what the presence questions read.
 *
 * Finding the car and the phone takes `getAllDevices` -- every device in the house, every
 * attribute, batch after batch -- because they are recognised by their names and entity ids,
 * which Home Assistant cannot match for us. Once they have been found, their ids are enough, and
 * re-rendering just those two devices is one small template instead of the whole house.
 *
 * Only `latitude` and `longitude` are kept of the attributes, because the car's position is the
 * only attribute anything here reads. Everything else a device reports -- its entities, their
 * states, names, areas and labels -- comes back in the same shape `getAllDevices` returns.
 */

/** The attributes worth rendering: where the car is. */
const RENDERED_ATTRIBUTES = ['latitude', 'longitude'];

const renderedDevicesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    labels: z.array(z.string()),
    area: z.string().nullable(),
    last_changed: z.string(),
    entities: z.array(
      z.object({
        id: z.string(),
        domain: z.string(),
        area: z.string().nullable(),
        labels: z.array(z.string()),
        state: z.string(),
        attributes: z.record(z.string(), z.unknown()),
        last_changed: z.string(),
      }),
    ),
  }),
);

/**
 * The template that renders the given devices.
 *
 * Mirrors the device template behind `getAllDevices`: an entity without a state is left out,
 * a device without any entity left is left out, and a device's `last_changed` is that of its
 * most recently changed entity.
 */
export function buildPresenceDeviceTemplate(deviceIds: string[]): string {
  return `
{%- set ns = namespace(devices=[]) -%}
{%- for d in ${JSON.stringify(deviceIds)} -%}
  {%- set ea = namespace(items=[], latest=none) -%}
  {%- for e in device_entities(d) -%}
    {%- set st = states[e] -%}
    {%- if st -%}
      {%- if ea.latest is none or st.last_changed > ea.latest -%}
        {%- set ea.latest = st.last_changed -%}
      {%- endif -%}
      {%- set ad = namespace(obj={}) -%}
      {%- for k in ${JSON.stringify(RENDERED_ATTRIBUTES)} -%}
        {%- set v = state_attr(e, k) -%}
        {%- if v is number or v is string -%}
          {%- set ad.obj = ad.obj|combine({k: v}) -%}
        {%- endif -%}
      {%- endfor -%}
      {%- set ea.items = ea.items + [{"id":e,"domain":st.domain,"area":area_name(e),"labels":labels(e)|list,"state":st.state,"attributes":ad.obj,"last_changed":st.last_changed.isoformat()}] -%}
    {%- endif -%}
  {%- endfor -%}
  {%- if ea.items -%}
    {%- set ns.devices = ns.devices + [{"id":d,"name":device_name(d) or d,"labels":labels(d)|list,"area":area_name(d),"last_changed":ea.latest.isoformat(),"entities":ea.items}] -%}
  {%- endif -%}
{%- endfor -%}
{{ ns.devices | to_json }}
`
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
}

/** Renders the given devices in one request. Devices Home Assistant no longer knows are absent. */
export async function renderDevicesById(deviceIds: string[]): Promise<DeviceState[]> {
  if (deviceIds.length === 0) {
    return [];
  }

  const response = await callHomeAssistantApi('template', 'POST', {
    template: buildPresenceDeviceTemplate(deviceIds),
  });
  const parsed: unknown = typeof response === 'string' ? JSON.parse(response) : response;

  return renderedDevicesSchema.parse(parsed);
}
