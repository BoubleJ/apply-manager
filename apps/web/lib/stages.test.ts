import { describe, expect, it } from "vitest";

import {
  buildFunnelData,
  computeSummary,
  dashboardHref,
  filterApplications,
  parseFilterKey,
  stageMatchesFilter,
} from "./stages";
import type { Stage } from "@apply-manager/shared";

const app = (currentStage: Stage, stages: Stage[]) => ({
  currentStage,
  events: stages.map((stage) => ({ stage })),
});

describe("parseFilterKey", () => {
  it("유효한 키는 그대로, 그 외는 all", () => {
    expect(parseFilterKey("in_progress")).toBe("in_progress");
    expect(parseFilterKey("passed")).toBe("passed");
    expect(parseFilterKey("nope")).toBe("all");
    expect(parseFilterKey(undefined)).toBe("all");
    expect(parseFilterKey(["passed"])).toBe("all");
  });
});

describe("stageMatchesFilter", () => {
  it("진행중: 결과가 나지 않은 단계만", () => {
    expect(stageMatchesFilter("applied", "in_progress")).toBe(true);
    expect(stageMatchesFilter("interview_2", "in_progress")).toBe(true);
    expect(stageMatchesFilter("rejected", "in_progress")).toBe(false);
    expect(stageMatchesFilter("offer", "in_progress")).toBe(false);
    expect(stageMatchesFilter("withdrawn", "in_progress")).toBe(false);
  });

  it("탈락: 서류탈락과 전형 탈락 모두 포함", () => {
    expect(stageMatchesFilter("document_rejected", "rejected")).toBe(true);
    expect(stageMatchesFilter("rejected", "rejected")).toBe(true);
    expect(stageMatchesFilter("withdrawn", "rejected")).toBe(false);
  });

  it("면접중: 과제~2차면접", () => {
    expect(stageMatchesFilter("assignment", "interviewing")).toBe(true);
    expect(stageMatchesFilter("interview_1_passed", "interviewing")).toBe(true);
    expect(stageMatchesFilter("applied", "interviewing")).toBe(false);
  });
});

describe("filterApplications", () => {
  it("all은 전부 통과", () => {
    const apps = [app("applied", ["applied"]), app("rejected", ["applied"])];
    expect(filterApplications(apps, "all")).toHaveLength(2);
    expect(filterApplications(apps, "in_progress")).toHaveLength(1);
  });
});

describe("buildFunnelData", () => {
  it("각 단계 도달 건수를 센다 (탈락해도 도달 이력은 유지)", () => {
    const apps = [
      app("rejected", ["applied", "document_passed", "interview_1", "rejected"]),
      app("document_rejected", ["applied", "document_rejected"]),
      app("offer", [
        "applied",
        "document_passed",
        "interview_1",
        "interview_2",
        "final_passed",
        "offer",
      ]),
      app("applied", ["applied"]),
    ];
    const data = buildFunnelData(apps);
    expect(data.map((d) => d.value)).toEqual([4, 2, 2, 1, 1]);
    expect(data[0]?.name).toBe("지원");
  });
});

describe("computeSummary", () => {
  it("서류합격률은 서류 결과가 나온 건 기준", () => {
    const apps = [
      app("interview_1", ["applied", "document_passed", "interview_1"]),
      app("document_rejected", ["applied", "document_rejected"]),
      app("applied", ["applied"]), // 결과 대기 — 분모 제외
    ];
    const summary = computeSummary(apps);
    expect(summary.total).toBe(3);
    expect(summary.inProgress).toBe(2);
    expect(summary.docPassRate).toBeCloseTo(0.5);
    expect(summary.finalCount).toBe(0);
  });

  it("서류 결과가 하나도 없으면 null", () => {
    expect(computeSummary([app("applied", ["applied"])]).docPassRate).toBeNull();
  });
});

describe("dashboardHref", () => {
  it("기본 필터는 파라미터 생략", () => {
    expect(dashboardHref("all")).toBe("/");
    expect(dashboardHref("passed")).toBe("/?filter=passed");
    expect(dashboardHref("all", "abc")).toBe("/?app=abc");
    expect(dashboardHref("rejected", "abc")).toBe("/?filter=rejected&app=abc");
  });
});
