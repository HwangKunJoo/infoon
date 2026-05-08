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
    private static final String PACKAGE_NAME = "com.infoon.tv";
    private static final String QUBER_AGENT_ACTION = "net.quber.qubersignageagent.QUBER_AGENT_SERVICE";
    private static final String QUBER_AGENT_PACKAGE = "net.quber.qubersignageagent";

    private IQuberManager aidl;
    private final ReactApplicationContext reactContext;
    private boolean isBound = false;

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
            isBound = true;

            Log.d(TAG, "Quber service connected: " + name);

            try {
                boolean registered = aidl.multiAgentResponse(PACKAGE_NAME, aidlListener);
                Log.d(TAG, "multiAgentResponse registered: " + registered);

                if (!registered) {
                    aidl.agentResponse(aidlListener);
                    Log.d(TAG, "fallback agentResponse registered");
                }
            } catch (RemoteException e) {
                Log.e(TAG, "Callback registration failed", e);
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            aidl = null;
            isBound = false;
            Log.d(TAG, "Quber service disconnected: " + name);
        }
    };

    private final IQuberCallback.Stub aidlListener = new IQuberCallback.Stub() {
        @Override
        public void responseListener(String jsonMsg) {
            Log.d(TAG, "Received from Quber: " + jsonMsg);

            try {
                JSONObject msg = new JSONObject(jsonMsg);
                String respId = msg.optString("responseId", msg.optString("requestId", null));

                if (respId != null) {
                    Promise promise = pending.remove(respId);

                    if (promise != null) {
                        promise.resolve(jsonMsg);
                        return;
                    }
                }
            } catch (JSONException e) {
                Log.e(TAG, "Invalid JSON in responseListener", e);
            }

            if (reactContext.hasActiveCatalystInstance()) {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("QuberResponse", jsonMsg);
            }
        }
    };

    private void bindQuberService() {
        try {
            Intent intent = new Intent(QUBER_AGENT_ACTION);
            intent.setPackage(QUBER_AGENT_PACKAGE);

            boolean result = reactContext.bindService(
                intent,
                connection,
                Context.BIND_AUTO_CREATE
            );

            Log.d(TAG, "bindQuberService result: " + result);
        } catch (Exception e) {
            Log.e(TAG, "bindQuberService exception", e);
        }
    }

    @ReactMethod
    public void isConnected(Promise promise) {
        promise.resolve(aidl != null && isBound);
    }

    @ReactMethod
    public void sendRequest(String jsonMsg, Promise promise) {
        try {
            if (jsonMsg == null) {
                promise.reject("MESSAGE_NULL", "message is null");
                return;
            }

            if (aidl == null || !isBound) {
                Log.d(TAG, "AIDL not ready. retry bind.");
                bindQuberService();
                promise.reject("AIDL_NOT_READY", "AIDL not connected");
                return;
            }

            JSONObject msg = new JSONObject(jsonMsg);
            String reqId = msg.getString("requestId");

            pending.put(reqId, promise);

            boolean sent;

            try {
                sent = aidl.multiSendRequestCmd(PACKAGE_NAME, jsonMsg);
                Log.d(TAG, "multiSendRequestCmd sent: " + sent);
            } catch (RemoteException e) {
                Log.e(TAG, "multiSendRequestCmd failed. fallback sendRequestCmd", e);
                sent = aidl.sendRequestCmd(jsonMsg);
                Log.d(TAG, "sendRequestCmd fallback sent: " + sent);
            }

            if (!sent) {
                pending.remove(reqId);
                promise.reject("SEND_FAILED", "Quber sendRequest returned false");
            }
        } catch (Exception e) {
            promise.reject("SEND_EXCEPTION", e.getMessage(), e);
        }
    }

    @Override
    public void invalidate() {
        super.invalidate();

        try {
            if (aidl != null) {
                try {
                    aidl.multiClose(PACKAGE_NAME);
                } catch (Exception ignored) {}
            }

            if (isBound) {
                reactContext.unbindService(connection);
            }
        } catch (Exception e) {
            Log.e(TAG, "invalidate error", e);
        } finally {
            aidl = null;
            isBound = false;
            pending.clear();
        }
    }
}