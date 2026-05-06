// 파일 경로: src/main/aidl/net/quber/qubersignageagent/IQuberManager.aidl

package net.quber.qubersignageagent;

import net.quber.qubersignageagent.IQuberCallback;

/**
 * 큐버 Signage Agent와 통신하기 위한 메인 인터페이스
 */
interface IQuberManager {
    /**
     * 단일 명령 요청 (싱글 바인딩용)
     * @param jsonMsg JSON 형식의 명령
     * @return 명령 처리 성공 여부
     */
    boolean sendRequestCmd(String jsonMsg);

    /**
     * 단일 콜백 등록 (싱글 바인딩용)
     * @param responseCallback 응답 수신 콜백
     */
    oneway void agentResponse(IQuberCallback responseCallback);

    /**
     * 명령 요청 (멀티 바인딩용)
     * @param packageName 호출한 앱의 패키지명 (구분자 역할)
     * @param jsonMsg JSON 명령
     * @return 명령 처리 성공 여부
     */
    boolean multiSendRequestCmd(String packageName, String jsonMsg);

    /**
     * 멀티 콜백 등록
     * @param packageName 호출한 앱의 패키지명
     * @param responseCallback 응답 수신 콜백
     * @return 등록 성공 여부
     */
    boolean multiAgentResponse(String packageName, IQuberCallback responseCallback);

    /**
     * 멀티 콜백 해제
     * @param packageName 호출한 앱의 패키지명
     * @return 해제 성공 여부
     */
    boolean multiClose(String packageName);
}
