import { NativeModules } from 'react-native';

const { QuberModule } = NativeModules;

export const PACKAGE_NAME = 'com.infoon.tv';

export type QuberResponse = string;

const CMD = {
  READ_PACKAGE_LIST: '211033',
  READ_AUTORUN: '211034',
  SET_AUTORUN: '213019',
  DELETE_AUTORUN: '215021',
} as const;

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

export function makeRequestId() {
  const now = new Date();

  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds()) +
    pad(now.getMilliseconds(), 3)
  );
}

export async function sendQuberRequest(
  cmdCode: string,
  params?: Record<string, unknown>,
): Promise<QuberResponse> {
  if (!QuberModule?.sendRequest) {
    throw new Error('QuberModule is not available. Native module 연결을 확인해줘.');
  }

  const payload: Record<string, unknown> = {
    requestId: makeRequestId(),
    cmdCode,
  };

  if (params) {
    payload.params = params;
  }

  return await QuberModule.sendRequest(JSON.stringify(payload));
}

export async function readPackageList() {
  return await sendQuberRequest(CMD.READ_PACKAGE_LIST);
}

export async function readAutoRun() {
  return await sendQuberRequest(CMD.READ_AUTORUN);
}

export async function setAutoRun(packageName = PACKAGE_NAME) {
  return await sendQuberRequest(CMD.SET_AUTORUN, {
    packageName,
  });
}

export async function deleteAutoRun() {
  return await sendQuberRequest(CMD.DELETE_AUTORUN);
}

export function prettyJson(value: unknown) {
  if (typeof value !== 'string') {
    return JSON.stringify(value, null, 2);
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}