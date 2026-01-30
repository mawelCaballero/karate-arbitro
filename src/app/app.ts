import { TitleCasePipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';

type CategoryKey = 'kata' | 'kumite' | 'parakarate';

interface Question {
  id: number;
  category: CategoryKey;
  text: string;
  answer: boolean | string;
  explanation: string;
  type: 'true_false' | 'multiple';
  options?: QuestionOption[];
}

interface QuestionOption {
  letter: string;
  text: string;
  correct: boolean;
}

const TOTAL_QUESTIONS = 30;
const EXAM_ASSET_URL = './examen_wkf_2026.json';
const normalizeQuestionText = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

type RawCategory = 'kata' | 'kumite' | 'kata_parakarate' | 'parakarate';

interface RawQuestion {
  numero: number;
  categoria: RawCategory;
  pregunta: string;
  respuesta: boolean | null;
  aclaracion?: string;
  tipo?: 'opcion_multiple' | 'verdadero_falso';
  opciones?: {
    letra: string;
    texto: string;
    correcta: boolean;
  }[];
}

interface RawExamData {
  preguntas: RawQuestion[];
}

const CATEGORY_MAP: Record<RawCategory, CategoryKey> = {
  kata: 'kata',
  kumite: 'kumite',
  kata_parakarate: 'parakarate',
  parakarate: 'parakarate',
};

@Component({
  selector: 'app-root',
  imports: [TitleCasePipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly totalQuestions = TOTAL_QUESTIONS;
  protected readonly mode = signal<'setup' | 'exam' | 'result'>('setup');
  protected readonly categoryOptions = signal([
    { key: 'kata' as CategoryKey, label: 'Kata', hint: 'Técnica y precisión', enabled: true },
    { key: 'kumite' as CategoryKey, label: 'Kumite', hint: 'Combate y control', enabled: true },
    { key: 'parakarate' as CategoryKey, label: 'Parakarate', hint: 'Adaptación y seguridad', enabled: true },
  ]);
  protected readonly questionBank = signal<Question[]>([]);
  protected readonly examQuestions = signal<Question[]>([]);
  protected readonly currentIndex = signal(0);
  protected readonly answers = signal<Record<number, boolean | string | null>>({});
  protected readonly usedQuestionIds = signal<Set<number>>(new Set());
  protected readonly usedQuestionTexts = signal<Set<string>>(new Set());
  protected readonly isAnimating = signal(false);
  protected readonly swipeDirection = signal<'left' | 'right' | ''>('');
  protected readonly enterDirection = signal<'left' | 'right' | ''>('');

  protected readonly selectedCategories = computed(() =>
    this.categoryOptions()
      .filter((option) => option.enabled)
      .map((option) => option.key),
  );

  protected readonly availableQuestions = computed(() =>
    this.questionBank().filter((question) => this.selectedCategories().includes(question.category)),
  );
  protected readonly uniqueAvailableQuestions = computed(() =>
    this.uniqueByText(this.availableQuestions()),
  );

  protected readonly canStart = computed(
    () =>
      this.selectedCategories().length > 0 &&
      this.uniqueAvailableQuestions().length >= TOTAL_QUESTIONS,
  );

  protected readonly currentQuestion = computed(
    () => this.examQuestions()[this.currentIndex()] ?? null,
  );

  protected readonly answeredCount = computed(() => {
    const answers = this.answers();
    return this.examQuestions().reduce((count, question) => {
      if (answers[question.id] !== null && answers[question.id] !== undefined) {
        return count + 1;
      }
      return count;
    }, 0);
  });

  protected readonly score = computed(() => {
    const answers = this.answers();
    return this.examQuestions().reduce((count, question) => {
      const userAnswer = answers[question.id];
      if (userAnswer === null || userAnswer === undefined) {
        return count;
      }
      return this.isAnswerCorrect(question, userAnswer) ? count + 1 : count;
    }, 0);
  });

  protected readonly wrongItems = computed(() => {
    const answers = this.answers();
    return this.examQuestions()
      .map((question) => {
        const userAnswer = answers[question.id];
        if (userAnswer === null || userAnswer === undefined) {
          return null;
        }
        if (this.isAnswerCorrect(question, userAnswer)) {
          return null;
        }
        return { question, userAnswer };
      })
      .filter(
        (item): item is { question: Question; userAnswer: boolean | string } => item !== null,
      );
  });

  ngOnInit() {
    void this.loadQuestions();
  }

  protected toggleCategory(key: CategoryKey) {
    this.categoryOptions.update((options) =>
      options.map((option) =>
        option.key === key ? { ...option, enabled: !option.enabled } : option,
      ),
    );
  }

  protected startExam() {
    if (!this.canStart()) {
      return;
    }
    const used = this.usedQuestionIds();
    const usedTexts = this.usedQuestionTexts();
    const available = this.uniqueAvailableQuestions();
    let pool = available.filter(
      (question) =>
        !used.has(question.id) && !usedTexts.has(normalizeQuestionText(question.text)),
    );
    if (pool.length < TOTAL_QUESTIONS) {
      pool = available;
      this.usedQuestionIds.set(new Set());
      this.usedQuestionTexts.set(new Set());
    }
    const picked = this.shuffleArray(pool).slice(0, TOTAL_QUESTIONS);
    this.usedQuestionIds.update((ids) => {
      const next = new Set(ids);
      picked.forEach((question) => next.add(question.id));
      return next;
    });
    this.usedQuestionTexts.update((texts) => {
      const next = new Set(texts);
      picked.forEach((question) => next.add(normalizeQuestionText(question.text)));
      return next;
    });
    const freshAnswers: Record<number, boolean | string | null> = {};
    picked.forEach((question) => {
      freshAnswers[question.id] = null;
    });
    this.examQuestions.set(picked);
    this.answers.set(freshAnswers);
    this.currentIndex.set(0);
    this.mode.set('exam');
  }

  protected finishExam() {
    this.mode.set('result');
  }

  protected restartExam() {
    this.mode.set('setup');
    this.examQuestions.set([]);
    this.answers.set({});
    this.currentIndex.set(0);
    this.isAnimating.set(false);
    this.swipeDirection.set('');
    this.enterDirection.set('');
  }

  protected answerCurrent(value: boolean) {
    const question = this.currentQuestion();
    if (!question) {
      return;
    }
    this.answers.update((answers) => ({ ...answers, [question.id]: value }));
    if (this.currentIndex() < this.examQuestions().length - 1) {
      this.goToIndex(this.currentIndex() + 1, 'left');
    }
  }

  protected previousQuestion() {
    if (this.currentIndex() === 0) {
      return;
    }
    this.goToIndex(this.currentIndex() - 1, 'right');
  }

  protected nextQuestion() {
    if (this.currentIndex() >= this.examQuestions().length - 1) {
      return;
    }
    this.goToIndex(this.currentIndex() + 1, 'left');
  }

  protected hasAnsweredCurrent() {
    const question = this.currentQuestion();
    if (!question) {
      return false;
    }
    const answer = this.answers()[question.id];
    return answer !== null && answer !== undefined;
  }

  protected isMultiple(question: Question) {
    return question.type === 'multiple';
  }

  protected selectOption(optionLetter: string) {
    const question = this.currentQuestion();
    if (!question) {
      return;
    }
    this.answers.update((answers) => ({ ...answers, [question.id]: optionLetter }));
    if (this.currentIndex() < this.examQuestions().length - 1) {
      this.goToIndex(this.currentIndex() + 1, 'left');
    }
  }

  protected optionLabel(option: QuestionOption) {
    return `${option.letter}. ${option.text}`;
  }

  protected displayAnswer(question: Question, value: boolean | string | null) {
    if (value === null || value === undefined) {
      return 'Sin respuesta';
    }
    if (question.type === 'multiple') {
      const option = question.options?.find((item) => item.letter === value);
      return option ? `${option.letter}. ${option.text}` : `${value}`;
    }
    return value ? 'Verdadero' : 'Falso';
  }

  protected displayCorrectAnswer(question: Question) {
    if (question.type === 'multiple') {
      const option = question.options?.find((item) => item.correct);
      return option ? `${option.letter}. ${option.text}` : 'Sin definir';
    }
    return question.answer ? 'Verdadero' : 'Falso';
  }

  private async loadQuestions() {
    try {
      const response = await fetch(EXAM_ASSET_URL);
      if (!response.ok) {
        throw new Error(`No se pudo cargar ${EXAM_ASSET_URL}`);
      }
      const data = (await response.json()) as RawExamData;
      const mapped = data.preguntas
        .map<Question | null>((item) => {
          const category = CATEGORY_MAP[item.categoria];
          if (!category) {
            return null;
          }
          if (item.tipo === 'opcion_multiple' && item.opciones?.length) {
            const options = item.opciones.map((option) => ({
              letter: option.letra,
              text: option.texto,
              correct: option.correcta,
            }));
            const correct = options.find((option) => option.correct);
            return {
              id: item.numero,
              category,
              text: item.pregunta,
              answer: correct?.letter ?? '',
              explanation: item.aclaracion ?? '',
              type: 'multiple',
              options,
            };
          }
          if (item.respuesta === null) {
            return null;
          }
          return {
            id: item.numero,
            category,
            text: item.pregunta,
            answer: item.respuesta === true,
            explanation: item.aclaracion ?? '',
            type: 'true_false',
          };
        })
        .filter((item): item is Question => item !== null);
      this.questionBank.set(mapped);
    } catch (error) {
      console.error('Error cargando preguntas:', error);
      this.questionBank.set([]);
    }
  }

  private isAnswerCorrect(question: Question, userAnswer: boolean | string) {
    if (question.type === 'multiple') {
      return userAnswer === question.answer;
    }
    return userAnswer === question.answer;
  }

  private uniqueByText(questions: Question[]) {
    const seen = new Set<string>();
    return questions.filter((question) => {
      const key = normalizeQuestionText(question.text);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private goToIndex(index: number, direction: 'left' | 'right') {
    if (this.isAnimating() || index === this.currentIndex()) {
      return;
    }
    this.isAnimating.set(true);
    this.swipeDirection.set(direction);
    window.setTimeout(() => {
      this.currentIndex.set(index);
      this.isAnimating.set(false);
      this.swipeDirection.set('');
      this.enterDirection.set(direction);
      window.setTimeout(() => {
        this.enterDirection.set('');
      }, 220);
    }, 220);
  }

  private shuffleArray<T>(items: T[]) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}
