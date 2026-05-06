package com.infoon.tv;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.os.RemoteException;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import net.quber.qubersignageagent.IQuberCallback;
import net.quber.qubersignageagent.IQuberManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class QuberModule extends ReactContextBaseJavaModule {
    private static final String TAG = "QuberModule";
    private IQuberManager aidl;
    private final ReactApplicationContext reactContext;

    // AIDL 요청에 대한 Promise 매핑
    private final Map<String, Promise> pending = new ConcurrentHashMap<>();

    public QuberModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        bindQuberService();
    }

    @NonNull
    @Override
    public String getName() {
        return "QuberModule";
    }

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            aidl = IQuberManager.Stub.asInterface(service);
            try {
                aidl.agentResponse(aidlListener);
                Log.d(TAG, "Connected and registered callback");
            } catch (RemoteException e) {
                Log.e(TAG, "Callback registration failed", e);
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            aidl = null;
            Log.d(TAG, "Service disconnected");
        }
    };

    private final IQuberCallback.Stub aidlListener = new IQuberCallback.Stub() {
        @Override
        public void responseListener(String jsonMsg) {
            Log.d(TAG, "Received from Quber: " + jsonMsg);
            try {
                JSONObject msg = new JSONObject(jsonMsg);
                // responseId 또는 requestId를 키로 Promise 조회
                String respId = msg.optString("responseId", msg.optString("requestId", null));
                if (respId != null) {
                    Promise promise = pending.remove(respId);
                    if (promise != null) {
                        // Promise가 있으면 JSON 전체를 resolve
                        promise.resolve(jsonMsg);
                        return;
                    }
                }
            } catch (JSONException e) {
                Log.e(TAG, "Invalid JSON in responseListener", e);
            }
            // 매핑된 Promise가 없으면 기존 이벤트 방출
            if (reactContext.hasActiveCatalystInstance()) {
                reactContext
                  .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                  .emit("QuberResponse", jsonMsg);
            }
        }
    };

    private void bindQuberService() {
        Intent intent = new Intent("net.quber.qubersignageagent.QUBER_AGENT_SERVICE");
        intent.setPackage("net.quber.qubersignageagent");
        reactContext.bindService(intent, connection, Context.BIND_AUTO_CREATE);
    }

    /**
     * AIDL 커맨드를 보내고, 해당 requestId에 대한 응답 JSON 전체를 Promise로 반환합니다.
     * JSON 메시지에 반드시 requestId 필드가 포함되어 있어야 합니다.
     */
    @ReactMethod
    public void sendRequest(String jsonMsg, Promise promise) {
        try {
            if (aidl == null || jsonMsg == null) {
                promise.reject("AIDL_NOT_READY", "AIDL not connected or message is null");
                return;
            }
            JSONObject msg = new JSONObject(jsonMsg);
            String reqId = msg.getString("requestId");
            // Promise 저장
            pending.put(reqId, promise);
            boolean sent = aidl.sendRequestCmd(jsonMsg);
            if (!sent) {
                // 전송 실패 시 즉시 reject
                pending.remove(reqId);
                promise.reject("SEND_FAILED", "aidl.sendRequestCmd returned false");
            }
        } catch (Exception e) {
            promise.reject("SEND_EXCEPTION", e.getMessage(), e);
        }
    }
}
