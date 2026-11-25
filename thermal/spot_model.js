/**
 * spot_model.js
 * 스팟 위치 학습 모델 관리자 (다중 샘플 누적 평균 & 정밀 학습)
 * - 99.atr 공식 파일에서 추출한 현장 62개 회로 실측 스팟 좌표 기본 탑재
 * - 파일명/회로명 패턴별 스팟 좌표 누적 학습 및 자동 이동
 * - 브라우저 localStorage 및 WS_THERMAL 통로 영구 동기화
 */

const DEFAULT_PATTERNS_99 = {
"IWC (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "IWC (3)"
  },
  "닐리 로탄 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "닐리 로탄 (3)"
  },
  "닐리 로탄 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "닐리 로탄 (5)"
  },
  "다미아니 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "다미아니 (3)"
  },
  "로에베 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "로에베 (3)"
  },
  "로에베 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "로에베 (5)"
  },
  "로저드뷔 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "로저드뷔 (3)"
  },
  "로저드뷔 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "로저드뷔 (5)"
  },
  "로저비비에 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "로저비비에 (3)"
  },
  "리모와 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "리모와 (3)"
  },
  "리모와 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "리모와 (5)"
  },
  "막스마라 (1)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "막스마라 (1)"
  },
  "막스마라 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "막스마라 (3)"
  },
  "막스마라 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "막스마라 (5)"
  },
  "멀버리 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "멀버리 (3)"
  },
  "멀버리 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "멀버리 (5)"
  },
  "메시카 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "메시카 (3)"
  },
  "메시카 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "메시카 (5)"
  },
  "몽클레르 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "몽클레르 (3)"
  },
  "몽클레르 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "몽클레르 (5)"
  },
  "발렌시아가 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "발렌시아가 (3)"
  },
  "발렌시아가 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "발렌시아가 (5)"
  },
  "발망 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "발망 (3)"
  },
  "발망 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "발망 (5)"
  },
  "부쉐론 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "부쉐론 (3)"
  },
  "브라이틀링 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "브라이틀링 (3)"
  },
  "브라이틀링 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "브라이틀링 (5)"
  },
  "브레게 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "브레게 (3)"
  },
  "브레게 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "브레게 (5)"
  },
  "블랑팡 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "블랑팡 (3)"
  },
  "블랑팡 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "블랑팡 (5)"
  },
  "사파이어 라운지 (1)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "사파이어 라운지 (1)"
  },
  "사파이어 라운지 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "사파이어 라운지 (3)"
  },
  "셀린느 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "셀린느 (3)"
  },
  "셀린느 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "셀린느 (5)"
  },
  "쇼파드 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "쇼파드 (3)"
  },
  "쇼파드 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "쇼파드 (5)"
  },
  "예거 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "예거 (3)"
  },
  "예거 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "예거 (5)"
  },
  "오메가 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "오메가 (3)"
  },
  "오메가 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "오메가 (5)"
  },
  "위블로 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "위블로 (3)"
  },
  "위블로 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "위블로 (5)"
  },
  "케이트 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "케이트 (5)"
  },
  "타사키 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "타사키 (3)"
  },
  "타사키 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "타사키 (5)"
  },
  "태그호이어 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "태그호이어 (3)"
  },
  "태그호이어 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "태그호이어 (5)"
  },
  "토즈 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "토즈 (3)"
  },
  "토즈 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "토즈 (5)"
  },
  "톰브라운 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "톰브라운 (3)"
  },
  "톰브라운 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "톰브라운 (5)"
  },
  "튜더 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "튜더 (3)"
  },
  "튜더 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "튜더 (5)"
  },
  "파네라이 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "파네라이 (3)"
  },
  "파네라이 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "파네라이 (5)"
  },
  "프레드 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "프레드 (3)"
  },
  "프레드 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "프레드 (5)"
  },
  "피아제 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "피아제 (3)"
  },
  "피아제 (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "피아제 (5)"
  },
  "IWC (5)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "IWC (5)"
  },
  "델보 (3)": {
    "count": 1,
    "spots": [
      {
        "x": 51,
        "y": 152
      },
      {
        "x": 144,
        "y": 152
      },
      {
        "x": 238,
        "y": 152
      }
    ],
    "label": "델보 (3)"
  }
};

class SpotModelManager {
    constructor() {
        this.model = {
            version: "2.1",
            default: [
                { x: 65, y: 152 },
                { x: 150, y: 152 },
                { x: 235, y: 152 }
            ],
            patterns: {} // key -> { count: N, spots: [{x, y}, {x, y}, {x, y}], label: string }
        };

        // 99.atr 초기 패턴 탑재
        this.loadPatterns(DEFAULT_PATTERNS_99);
    }

    clear() {
        this.model.patterns = {};
    }

    removePattern(keyOrLabel) {
        const key = this.normalizeKey(keyOrLabel);
        if (key && this.model.patterns[key]) {
            delete this.model.patterns[key];
            return true;
        }
        for (const [k, v] of Object.entries(this.model.patterns)) {
            if (v.label === keyOrLabel || k === keyOrLabel) {
                delete this.model.patterns[k];
                return true;
            }
        }
        return false;
    }

    loadPatterns(patternsObj) {
        if (!patternsObj || typeof patternsObj !== 'object') return;
        for (const [k, v] of Object.entries(patternsObj)) {
            const key = this.normalizeKey(k);
            if (!key) continue;
            if (Array.isArray(v)) {
                this.model.patterns[key] = {
                    count: 1,
                    spots: v,
                    label: k
                };
            } else if (v && v.spots) {
                this.model.patterns[key] = {
                    count: v.count || 1,
                    spots: v.spots,
                    label: v.label || k
                };
            }
        }
    }

    load(modelData) {
        if (!modelData || typeof modelData !== 'object') return;
        if (modelData.default) this.model.default = modelData.default;
        if (modelData.patterns !== undefined) {
            this.model.patterns = {};
            this.loadPatterns(modelData.patterns);
        }
    }

    /**
     * 특정 회로명 또는 파일명에 대한 최적 스팟 좌표 예측
     */
    predict(circuitName, fileName) {
        const key1 = this.normalizeKey(circuitName);
        const key2 = this.normalizeKey(fileName);
        const patterns = this.model.patterns || {};

        // 1. 완전 일치
        let result = null;
        if (key1 && patterns[key1]) result = patterns[key1].spots;
        else if (key2 && patterns[key2]) result = patterns[key2].spots;

        // 2. 괄호/숫자 제외한 베이스 키 일치 (예: 'IWC (3)' -> 'iwc')
        if (!result) {
            const baseKey1 = this.baseKey(circuitName);
            const baseKey2 = this.baseKey(fileName);
            if (baseKey1) {
                for (const [k, entry] of Object.entries(patterns)) {
                    if (this.baseKey(k) === baseKey1) { result = entry.spots; break; }
                }
            }
            if (!result && baseKey2) {
                for (const [k, entry] of Object.entries(patterns)) {
                    if (this.baseKey(k) === baseKey2) { result = entry.spots; break; }
                }
            }
        }

        // 3. 부분 문자열 포함 일치
        if (!result) {
            if (key1) {
                for (const [k, entry] of Object.entries(patterns)) {
                    if (key1.includes(k) || k.includes(key1)) { result = entry.spots; break; }
                }
            }
            if (!result && key2) {
                for (const [k, entry] of Object.entries(patterns)) {
                    if (key2.includes(k) || k.includes(key2)) { result = entry.spots; break; }
                }
            }
        }

        const out = result ? JSON.parse(JSON.stringify(result)) : JSON.parse(JSON.stringify(this.model.default));

        // [핵심 보정 1] 케이블 피복선(상단 Y<135)으로 빗나간 경우 단자대 볼트 체결 높이(y=152)로 자동 안착
        for (let i = 0; i < out.length; i++) {
            if (out[i].y < 135 || out[i].y > 175) {
                out[i].y = 152;
            }
        }

        // [핵심 보정 2] 분전반 3상 접속 단자는 물리적으로 수평 배열되므로, Y 편차가 10px 이상이면 평균 단자대 높이(148~155)로 수평 일렬 정렬
        const ys = [out[0].y, out[1].y, out[2].y];
        const yRange = Math.max(...ys) - Math.min(...ys);
        if (yRange > 10) {
            let centerY = Math.round((ys[0] + ys[1] + ys[2]) / 3);
            if (centerY < 140 || centerY > 165) centerY = 152;
            out[0].y = centerY;
            out[1].y = centerY;
            out[2].y = centerY;
        }

        return out;
    }

    isFull() {
        return Object.keys(this.model.patterns || {}).length >= 200;
    }

    hasPattern(circuitName) {
        const key = this.normalizeKey(circuitName);
        return !!(key && this.model.patterns && this.model.patterns[key]);
    }

    /**
     * 단일 샘플 학습 (기존 데이터와 누적 가중 평균)
     * 패턴 수가 200개에 도달하면 신규 학습을 금지합니다.
     */
    learn(circuitName, spots) {
        const key = this.normalizeKey(circuitName);
        if (!key || !spots || spots.length < 3) return false;

        if (!this.model.patterns) this.model.patterns = {};

        const existing = this.model.patterns[key];
        const currentCount = Object.keys(this.model.patterns).length;

        // 패턴 수 200개 도달 시 신규 패턴 학습 금지
        if (!existing && currentCount >= 200) {
            console.warn(`[SpotModelManager] 학습된 위치 패턴 수가 200개에 도달하여 신규 학습이 제한됩니다.`);
            return false;
        }

        if (existing && existing.count) {
            const n = existing.count;
            const newSpots = [];
            for (let i = 0; i < 3; i++) {
                const avgX = (existing.spots[i].x * n + spots[i].x) / (n + 1);
                const avgY = (existing.spots[i].y * n + spots[i].y) / (n + 1);
                newSpots.push({ x: Math.round(avgX), y: Math.round(avgY) });
            }
            this.model.patterns[key] = {
                count: n + 1,
                spots: newSpots,
                label: circuitName.trim(),
                updatedAt: new Date().toISOString()
            };
        } else {
            this.model.patterns[key] = {
                count: 1,
                spots: [
                    { x: Math.round(spots[0].x), y: Math.round(spots[0].y) },
                    { x: Math.round(spots[1].x), y: Math.round(spots[1].y) },
                    { x: Math.round(spots[2].x), y: Math.round(spots[2].y) }
                ],
                label: circuitName.trim(),
                updatedAt: new Date().toISOString()
            };
        }
        return true;
    }

    /**
     * 여러 예제 FLIR 파일(.jpg, .atr)로부터 일괄 학습 및 고도화
     */
    async trainFromFiles(files, progressCb = null) {
        let learnedCount = 0;
        let totalCount = 0;
        let reachedLimit = false;
        const failedFiles = [];

        for (let i = 0; i < files.length; i++) {
            if (this.isFull()) {
                reachedLimit = true;
                break;
            }

            const file = files[i];
            const isAtr = /\.atr$/i.test(file.name);
            const isJpg = /\.(jpe?g)$/i.test(file.name);

            if (!isAtr && !isJpg) continue;

            if (isAtr) {
                if (progressCb) progressCb(i + 1, files.length, `${file.name} (.atr 보고서 해제 중)`);
                try {
                    const data = (file instanceof Blob || typeof file.arrayBuffer === 'function') ? await file.arrayBuffer() : file;
                    const zip = await JSZip.loadAsync(data);
                    const binEntries = [];
                    zip.forEach((relPath, entry) => {
                        if (relPath.startsWith('cactus/') && !relPath.endsWith('_MT.bin') && !entry.dir) {
                            binEntries.push(entry);
                        }
                    });

                    let atrLearned = 0;
                    for (const entry of binEntries) {
                        if (this.isFull()) {
                            reachedLimit = true;
                            break;
                        }
                        try {
                            const bytes = await entry.async('uint8array');
                            if (bytes.length > 2 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
                                totalCount++;
                                const blob = new Blob([bytes], { type: 'image/jpeg' });
                                const parsed = await FlirParser.parse(blob);

                                if (parsed.hasNativeSpots) {
                                    let circuitName = entry.name.replace(/^cactus\//, '').replace(/\.bin$/i, '');
                                    const mtEntry = zip.file(`${entry.name.replace(/\.bin$/i, '')}_MT.bin`);
                                    if (mtEntry) {
                                        try {
                                            const mt = JSON.parse(await mtEntry.async('string'));
                                            if (mt.Title) circuitName = mt.Title;
                                            else if (mt.Name) circuitName = mt.Name;
                                        } catch (_) {}
                                    }
                                    circuitName = circuitName.replace(/\.[^/.]+$/, '').trim();
                                    const ok = this.learn(circuitName, parsed.spots);
                                    if (ok) {
                                        learnedCount++;
                                        atrLearned++;
                                    } else {
                                        reachedLimit = true;
                                        break;
                                    }
                                } else {
                                    failedFiles.push(`${file.name}:${entry.name}`);
                                }
                            }
                        } catch (e) {
                            console.warn('ATR entry parse failed:', entry.name, e);
                        }
                    }

                    if (atrLearned === 0 && !reachedLimit) {
                        failedFiles.push(`${file.name} (스팟 미발견)`);
                    }
                } catch (err) {
                    console.warn('ATR processing error:', file.name, err);
                    failedFiles.push(`${file.name} (압축 해제 실패: ${err.message})`);
                }
            } else {
                totalCount++;
                if (progressCb) progressCb(i + 1, files.length, file.name);
                try {
                    const parsed = await FlirParser.parse(file);
                    if (parsed.hasNativeSpots) {
                        let circuitName = file.name.replace(/\.[^/.]+$/, '').trim();
                        const ok = this.learn(circuitName, parsed.spots);
                        if (ok) {
                            learnedCount++;
                        } else {
                            reachedLimit = true;
                            break;
                        }
                    } else {
                        failedFiles.push(file.name);
                    }
                } catch (e) {
                    console.warn('Skipping unparsable training file:', file.name, e);
                    failedFiles.push(`${file.name} (파싱 오류)`);
                }
            }
        }

        return {
            ok: learnedCount > 0,
            totalCount,
            learnedCount,
            failedFiles,
            reachedLimit
        };
    }

    normalizeKey(name) {
        if (!name) return '';
        let clean = String(name).replace(/\.[^/.]+$/, '');
        clean = clean.replace(/_\d{8}_\d{6}/, '');
        clean = clean.replace(/\s+/g, '').toLowerCase();
        return clean;
    }

    baseKey(name) {
        if (!name) return '';
        let clean = String(name).replace(/\.[^/.]+$/, '');
        clean = clean.replace(/\([^)]*\)/g, ''); // 괄호 내용 제거
        clean = clean.replace(/[0-9_\-\s]+/g, '').toLowerCase(); // 숫자, 언더바, 대시 제거
        return clean;
    }

    getPatternsList() {
        const list = [];
        if (!this.model.patterns) return list;
        for (const [key, val] of Object.entries(this.model.patterns)) {
            list.push({
                key,
                label: val.label || key,
                count: val.count || 1,
                spots: val.spots,
                updatedAt: val.updatedAt || ''
            });
        }
        return list;
    }

    export() {
        return this.model;
    }
}

if (typeof window !== 'undefined') {
    window.SpotModelManager = SpotModelManager;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SpotModelManager;
}
