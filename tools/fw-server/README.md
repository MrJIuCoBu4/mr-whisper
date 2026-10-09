# fw-server — движок распознавания на CTranslate2

Альтернативный движок для этого форка: тот же Whisper `large-v3-turbo`, но посчитанный
через [faster-whisper](https://github.com/SYSTRAN/faster-whisper) / CTranslate2 вместо
whisper.cpp. Приложение разговаривает с ним по тому же HTTP-протоколу, поэтому сам код
приложения менять не нужно — только указать адрес в конфиге.

## Зачем

На CPU whisper.cpp считает энкодер `large-v3-turbo` примерно за 25 секунд на фразу
(замерено на Ryzen 7 7840HS, 8 потоков), и это время не зависит ни от длины фразы —
модель всегда обрабатывает 30-секундное окно, — ни от флагов декодирования.
CTranslate2 использует int8-квантизацию и эффективнее работает с памятью, поэтому на
той же модели и том же процессоре даёт заметно меньшую задержку.

## Установка

```powershell
cd tools\fw-server
python -m venv .venv
.venv\Scripts\python.exe -m pip install faster-whisper
```

Модель в формате CT2 (около 1.5 ГБ) кладётся в `tools/fw-server/model`:

```powershell
python -c "from huggingface_hub import snapshot_download; snapshot_download('deepdml/faster-whisper-large-v3-turbo-ct2', local_dir='model')"
```

И venv, и модель исключены из git — это гигабайты, они не коммитятся.

## Запуск

Приложение поднимает сервис само: если в конфиге указан `whisperServerUrl`, движок
запускается при старте приложения и гасится при выходе (`src/helpers/fwServerSpawner.js`).
Ждать загрузки модели приложение умеет и на это время просто показывает панель.

Вручную — для отладки или отдельного запуска:

```powershell
start.bat
```

Слушает `http://127.0.0.1:8085`. Проверка живости — обычный GET на корень.

## Подключение к приложению

В `%APPDATA%\open-whispr\config.json`:

```json
{ "whisperServerUrl": "http://127.0.0.1:8085" }
```

Пустое значение (по умолчанию) — работает встроенный whisper.cpp. Если сервис не
отвечает или не установлен, приложение пишет предупреждение и откатывается на
локальный движок.

## Протокол

`POST /inference`, `multipart/form-data`:

| Поле | Значение |
|---|---|
| `file` | аудио (WAV/Opus/что угодно — декодируется через PyAV) |
| `language` | `ru`, `en`, … либо пусто для автоопределения |
| `prompt` | начальный промпт (в приложении — `whisperPrompt`) |
| `response_format` | `json` |

Ответ: `{"text": "распознанный текст"}`. Формат совпадает с whisper.cpp, поэтому
рендерер и IPC-слой приложения работают с ним без изменений.

## Параметры запуска

```
server.py --port 8085 --threads 8 --beam 5 --compute-type int8
```

VAD (обрезка тишины) включён всегда — используется silero из состава faster-whisper.
