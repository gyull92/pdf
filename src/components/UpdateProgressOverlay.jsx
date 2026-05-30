import styled from "styled-components";

const Overlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(248, 248, 248, 0.92);
  pointer-events: none;
`;

const Panel = styled.div`
  width: min(420px, 90%);
  padding: 28px 32px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid #e0e0e0;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  text-align: center;
`;

const Title = styled.h2`
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: #333;
`;

const Subtitle = styled.p`
  margin: 0 0 20px;
  font-size: 13px;
  color: #666;
`;

const Track = styled.div`
  height: 10px;
  border-radius: 5px;
  background: #eee;
  overflow: hidden;
`;

const Fill = styled.div`
  height: 100%;
  width: ${(p) => p.$percent}%;
  border-radius: 5px;
  background: linear-gradient(90deg, #ff9a3c, #ff6b00);
  transition: width 0.15s ease-out;
`;

const PercentLabel = styled.p`
  margin: 12px 0 0;
  font-size: 22px;
  font-weight: 600;
  color: #ff6b00;
`;

export default function UpdateProgressOverlay({ status }) {
  if (!status || status.phase !== "downloading") return null;

  const percent = Math.min(100, Math.max(0, status.percent ?? 0));
  const version = status.version ? `v${status.version}` : null;

  return (
    <Overlay role="status" aria-live="polite" aria-busy="true">
      <Panel>
        <Title>업데이트 다운로드 중</Title>
        <Subtitle>
          {version
            ? `새 버전 ${version}을(를) 받고 있습니다.`
            : "새 버전을 받고 있습니다."}
          <br />
          완료될 때까지 잠시만 기다려 주세요.
        </Subtitle>
        <Track>
          <Fill $percent={percent} />
        </Track>
        <PercentLabel>{percent}%</PercentLabel>
      </Panel>
    </Overlay>
  );
}
