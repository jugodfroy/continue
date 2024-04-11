import { BaseLLM } from "..";
import { ChatMessage, CompletionOptions, ModelProvider } from "../..";
import { getHeaders } from "../../continueServer/stubs/headers";
import { SERVER_URL } from "../../util/parameters";
import { streamResponse } from "../stream";

class FreeTrial extends BaseLLM {
  static providerName: ModelProvider = "free-trial";

  private ghAuthToken: string | undefined = undefined;

  setupGhAuthToken(ghAuthToken: string | undefined) {
    this.ghAuthToken = ghAuthToken;
  }

  private async _getHeaders() {
    if (!this.ghAuthToken) {
      throw new Error(
        "Please sign in with GitHub in order to use the free trial. If you'd like to use Continue without signing in, you can set up your own local model or API key.",
      );
    }
    return {
      "Content-Type": "application/json",
      ...getHeaders(),
    };
  }

  private async _countTokens(prompt: string, model: string, isPrompt: boolean) {
    if (!Telemetry.client) {
      throw new Error(
        'In order to use the free trial, telemetry must be enabled so that we can monitor abuse. To enable telemetry, set "allowAnonymousTelemetry": true in config.json and make sure the box is checked in IDE settings. If you use your own model (local or API key), telemetry will never be required.',
      );
    }
    const event = isPrompt
      ? "free_trial_prompt_tokens"
      : "free_trial_completion_tokens";
    Telemetry.capture(event, {
      tokens: this.countTokens(prompt),
      model,
    });
  }

  private _convertArgs(options: CompletionOptions): any {
    return {
      model: options.model,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      max_tokens: options.maxTokens,
      stop:
        options.model === "starcoder-7b"
          ? options.stop
          : options.stop?.slice(0, 2),
      temperature: options.temperature,
      top_p: options.topP,
    };
  }

  protected async *_streamComplete(
    prompt: string,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    const args = this._convertArgs(this.collectArgs(options));

    await this._countTokens(prompt, args.model, true);

    const response = await this.fetch(`${SERVER_URL}/stream_complete`, {
      method: "POST",
      headers: await this._getHeaders(),
      body: JSON.stringify({
        prompt,
        ...args,
      }),
    });

    let completion = "";
    for await (const value of streamResponse(response)) {
      yield value;
      completion += value;
    }
    this._countTokens(completion, args.model, false);
  }

  protected _convertMessage(message: ChatMessage) {
    if (typeof message.content === "string") {
      return message;
    }

    const parts = message.content.map((part) => {
      return {
        type: part.type,
        text: part.text,
        image_url: { ...part.imageUrl, detail: "low" },
      };
    });
    return {
      ...message,
      content: parts,
    };
  }

  protected async *_streamChat(
    messages: ChatMessage[],
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    const args = this._convertArgs(this.collectArgs(options));

    await this._countTokens(
      messages.map((m) => m.content).join("\n"),
      args.model,
      true,
    );

    const response = await this.fetch(`${SERVER_URL}/stream_chat`, {
      method: "POST",
      headers: await this._getHeaders(),
      body: JSON.stringify({
        messages: messages.map(this._convertMessage),
        ...args,
      }),
    });

    let completion = "";
    for await (const chunk of streamResponse(response)) {
      yield {
        role: "assistant",
        content: chunk,
      };
      completion += chunk;
    }
    this._countTokens(completion, args.model, false);
  }

  supportsFim(): boolean {
    return this.model === "codestral-latest";
  }

  async *_streamFim(
    prefix: string,
    suffix: string,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    const args = this._convertArgs(this.collectArgs(options));
    const resp = await this.fetch(`${SERVER_URL}/stream_fim`, {
      method: "POST",
      headers: await this._getHeaders(),
      body: JSON.stringify({
        prefix,
        suffix,
        ...args,
      }),
    });

    let completion = "";
    for await (const value of streamResponse(resp)) {
      yield value;
      completion += value;
    }
    this._countTokens(completion, args.model, false);
  }

  async listModels(): Promise<string[]> {
    return [
      "codestral-latest",
      "llama3-70b",
      "gpt-4o",
      "gpt-3.5-turbo",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307",
      "gemini-1.5-pro-latest",
    ];
  }
}

export default FreeTrial;
