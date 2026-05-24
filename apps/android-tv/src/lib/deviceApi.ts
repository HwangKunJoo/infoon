import { fetchJson } from "./apiClient";

export type RegisterDevicePayload = {
  modelId: string;
  modelName: string;
  orientation: string;
  userId: number;
  organization: string;
  organization_type: string;
};

export function registerDevice(token: string, payload: RegisterDevicePayload) {
  return fetchJson("/digital_board/devices/register", token, {
    method: "POST",
    body: JSON.stringify({
      model_id: payload.modelId,
      device_model_name: payload.modelName,
      orientation: payload.orientation,
      user_id: payload.userId,
      organization: payload.organization,
      organization_type: payload.organization_type,
    }),
  });
}

export function fetchDevices(token: string) {
  return fetchJson("/digital_board/devices", token);
}

export function getDeviceIdFromRegisterResponse(res: any) {
  if (res?.data?.data?.id) {
    return String(res.data.data.id);
  }

  if (res?.data?.id) {
    return String(res.data.id);
  }

  if (res?.data?.device?.id) {
    return String(res.data.device.id);
  }

  if (res?.device?.id) {
    return String(res.device.id);
  }

  if (res?.id) {
    return String(res.id);
  }

  return "";
}