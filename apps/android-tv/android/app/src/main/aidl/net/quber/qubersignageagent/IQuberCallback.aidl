// 파일 경로: src/main/aidl/net/quber/qubersignageagent/IQuberCallback.aidl

package net.quber.qubersignageagent;

/**
 * 큐버 Signage Agent에서 응답 메시지를 수신할 때 사용하는 콜백 인터페이스
 */
interface IQuberCallback {
    /**
     * 응답 수신
     * @param jsonMsg 응답 JSON 메시지
     */
    void responseListener(String jsonMsg);
}
