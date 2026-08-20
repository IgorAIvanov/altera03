/**
 * Звідки взяти пакет прикладного рішення.
 *
 * Фреймворк їде в установку з JSR і пінами; рішення — окремою поставкою, і досі
 * єдиним способом її дістати був файл, уже покладений на диск руками. Цей
 * модуль додає до того самого аргументу ще дві форми, не міняючи нічого нижче:
 * і `import-solution`, і `update-solution` далі працюють з локальним шляхом.
 *
 *   ./erp-1.2.0.tar.gz                # файл, як було
 *   https://…/erp-1.2.0.tar.gz        # прямий URL
 *   IgorAIvanov/altera-buh@1.2.0      # реліз GitHub
 *
 * Третя форма — не зручність, а шов. Сьогодні вона резолвиться в GitHub
 * Releases, завтра — в окремий каталог застосунків, і рядок, який набирає
 * адміністратор, від переїзду не міняється. Тому вид джерела вибирається за
 * ВИГЛЯДОМ специфікатора, а не прапорцем: прапорець довелося б міняти разом із
 * транспортом.
 *
 * Завантажений пакет лягає в тимчасовий файл і після роботи прибирається.
 * Тримати його ні до чого: повернутися до попередньої версії тепер означає
 * назвати її (`owner/repo@1.1.0`), а не шукати архів на диску.
 *
 * Приватний репозиторій — випадок звичайний, а не крайній: рішення взагалі
 * рідко буває публічним. Токен береться з `GITHUB_TOKEN` або `GH_TOKEN` (перше
 * ім'я — GitHub Actions, друге — `gh` CLI, обидва вже є там, де їх шукатимуть).
 */
import { basename } from "@std/path";

/** Розібраний специфікатор джерела. */
export type SolutionSource =
  | { kind: "file"; path: string }
  | { kind: "url"; url: string }
  | { kind: "github"; owner: string; repo: string; tag: string };

/** Пакет, готовий до читання, плюс те, як його прибрати. */
export interface ResolvedSolutionSource {
  /** Локальний шлях до `.tar.gz`. */
  path: string;
  /** Людський опис джерела — для друку й для повідомлень про відмову. */
  origin: string;
  /** Прибрати завантажене. Для локального файлу не робить нічого. */
  cleanup(): Promise<void>;
}

export interface ResolveOptions {
  /**
   * Ім'я ассета в релізі, якщо їх кілька.
   *
   * Умовчання — ЄДИНИЙ `.tar.gz`, а не перший: реліз із двома поставками це не
   * «беремо якусь», а питання, на яке інструмент відповіді не має.
   */
  asset?: string;
  /** Токен доступу; за замовчуванням — з оточення. */
  token?: string;
  /** Куди друкувати хід завантаження. */
  log?: (message: string) => void;
}

/**
 * `owner/repo@tag`, необов'язково з префіксом `github:`.
 *
 * Двозначність із локальним шляхом («dir/pkg@1.0.tar.gz») знімають дві умови:
 * сегментів рівно два і закінчення не `.tar.gz`. Хто справді має такий файл на
 * диску, пише `./dir/pkg@1.0.tar.gz` — з крапкою сегментів стає три. Префікс
 * `github:` знімає двозначність завжди.
 */
const GITHUB_SPEC = /^(?:github:)?([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*)@([^\s/]+)$/;

export function parseSolutionSource(spec: string): SolutionSource {
  const trimmed = spec.trim();

  if (/^https?:\/\//i.test(trimmed)) return { kind: "url", url: trimmed };

  const explicit = trimmed.startsWith("github:");
  if (explicit || !/\.tar\.gz$/i.test(trimmed)) {
    const match = GITHUB_SPEC.exec(trimmed);
    if (match) return { kind: "github", owner: match[1], repo: match[2], tag: match[3] };
    if (explicit) {
      throw new Error(
        `Не розумію джерело «${spec}». Форма релізу GitHub — github:<власник>/<репозиторій>@<тег>.`,
      );
    }
  }

  return { kind: "file", path: trimmed };
}

/**
 * Оточення може бути недоступне (`--allow-read` без `--allow-env`): публічний
 * репозиторій має працювати й так, тож мовчки лишаємося без токена.
 */
function fromEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name) || undefined;
  } catch {
    return undefined;
  }
}

/** GitHub Actions задає це сам; заразом покриває GitHub Enterprise. */
function apiBase(): string {
  return (fromEnv("GITHUB_API_URL") ?? "https://api.github.com").replace(/\/+$/, "");
}

interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

async function fetchRelease(
  owner: string,
  repo: string,
  tag: string,
  token: string | undefined,
): Promise<{ assets: ReleaseAsset[]; tagName: string }> {
  // `latest` — окремий ендпойнт, і він НЕ те саме, що найсвіжіший тег: GitHub
  // пропускає чернетки й передрелізи. Для поставки це саме те, що треба.
  const path = tag === "latest"
    ? `/repos/${owner}/${repo}/releases/latest`
    : `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;

  const response = await fetch(`${apiBase()}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

  if (response.status === 404) {
    await response.body?.cancel();
    // 404 на приватний репозиторій без токена — не «немає такого релізу», а
    // «не видно»: GitHub навмисно не розрізняє ці випадки у відповіді. Тому
    // розрізняємо в повідомленні — інакше адміністратор шукає одруківку в
    // тезі, а бракує токена.
    throw new Error(
      `Реліз ${owner}/${repo}@${tag} не знайдено (HTTP 404).\n` +
        (token
          ? "   Перевір тег і те, що токен має доступ до цього репозиторію."
          : "   Репозиторій приватний? Тоді потрібен GITHUB_TOKEN (або GH_TOKEN) з правом читання."),
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `GitHub відповів HTTP ${response.status} на запит релізу ${owner}/${repo}@${tag}.`,
    );
  }

  const release = await response.json() as { tag_name?: string; assets?: ReleaseAsset[] };
  return { assets: release.assets ?? [], tagName: release.tag_name ?? tag };
}

function pickAsset(
  assets: ReleaseAsset[],
  wanted: string | undefined,
  where: string,
): ReleaseAsset {
  if (wanted) {
    const found = assets.find((asset) => asset.name === wanted);
    if (found) return found;
    throw new Error(
      `У релізі ${where} немає ассета «${wanted}».\n` +
        `   Є: ${assets.map((asset) => asset.name).join(", ") || "жодного"}`,
    );
  }

  const packages = assets.filter((asset) => /\.tar\.gz$/i.test(asset.name));
  if (packages.length === 1) return packages[0];
  if (packages.length === 0) {
    throw new Error(
      `У релізі ${where} немає пакета (.tar.gz).\n` +
        "   Архіви «Source code», які GitHub чіпляє сам, поставкою не є: у них немає solution.json.",
    );
  }
  throw new Error(
    `У релізі ${where} кілька пакетів — назви потрібний прапорцем --asset:\n` +
      packages.map((asset) => `   ${asset.name}`).join("\n"),
  );
}

/**
 * Завантажити ассет у файл.
 *
 * Редирект відпрацьовується вручну і БЕЗ заголовка авторизації: посилання веде
 * на сховище іншого хоста, і токен, доїхавши туди, ламає запит — сховище бачить
 * два способи автентифікації одразу. Покладатися на те, що заголовок зріже
 * рантайм, не варто: це поведінка, якої не видно, поки вона є.
 */
async function download(
  assetUrl: string,
  token: string | undefined,
  destination: string,
): Promise<void> {
  const first = await fetch(assetUrl, {
    headers: {
      accept: "application/octet-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    redirect: "manual",
  });

  let response = first;
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get("location");
    await first.body?.cancel();
    if (!location) throw new Error(`GitHub відповів ${first.status} без адреси перенаправлення.`);
    response = await fetch(location, { headers: { accept: "application/octet-stream" } });
  }

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Завантаження пакета не вдалося: HTTP ${response.status}.`);
  }

  const file = await Deno.open(destination, { write: true, create: true, truncate: true });
  await response.body.pipeTo(file.writable);
}

async function toTempFile(
  name: string,
  fill: (destination: string) => Promise<void>,
): Promise<string> {
  const path = await Deno.makeTempFile({
    prefix: "altera-solution-",
    suffix: `-${basename(name)}`,
  });
  try {
    await fill(path);
  } catch (error) {
    await Deno.remove(path).catch(() => {});
    throw error;
  }
  return path;
}

const NO_CLEANUP = () => Promise.resolve();

/** Привести специфікатор до локального файлу, завантаживши його за потреби. */
export async function resolveSolutionSource(
  spec: string,
  options: ResolveOptions = {},
): Promise<ResolvedSolutionSource> {
  const source = parseSolutionSource(spec);
  const log = options.log ?? ((message: string) => console.log(message));
  const cleanupOf = (path: string) => () => Deno.remove(path).catch(() => {});

  if (source.kind === "file") {
    return { path: source.path, origin: source.path, cleanup: NO_CLEANUP };
  }

  const token = options.token ?? fromEnv("GITHUB_TOKEN") ?? fromEnv("GH_TOKEN");

  if (source.kind === "url") {
    log(`Завантажую ${source.url}`);
    const path = await toTempFile(source.url, (to) => download(source.url, token, to));
    return { path, origin: source.url, cleanup: cleanupOf(path) };
  }

  const where = `${source.owner}/${source.repo}@${source.tag}`;
  const { assets, tagName } = await fetchRelease(source.owner, source.repo, source.tag, token);
  const asset = pickAsset(assets, options.asset, where);

  log(`Завантажую ${asset.name} з релізу ${source.owner}/${source.repo}@${tagName}`);
  const path = await toTempFile(asset.name, (to) => download(asset.url, token, to));
  return {
    path,
    origin: `${source.owner}/${source.repo}@${tagName} · ${asset.name}`,
    cleanup: cleanupOf(path),
  };
}
