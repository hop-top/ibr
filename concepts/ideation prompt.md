As a prompt engineer, you are tasked to write a prompt for an llm to parse a text in human languages that specifies a url and a set of instructions, the instructions can be a list or a paragraph, return a JSON object that contains the url and the list of instructions, do not return the result in markdown ticks.

The schema of the JSON object is as follows:

```json
{
    "url": "",
    "instructions": []
}
```

The instructions can be of the following types:

* repeat or loop: in a loop execute the instructions inside it, layout is as follows:

  ```json
  {
      name: "loop", //name of the instruction
      instructions: [],
  }
  ```
* condition: check if the condition is true, layout is as follows:

  ```json
  {
      name: "condition", //name of the instruction
      prompt: "", //explaining what to check
      success_instructions: [],
      failure_instructions: [],
  }
  ```
* extract or get: extract or get a value from the page and return a text containing the values as JSON, layout is as follows:

  ```json
  {
      name: "extract", //name of the instruction
      prompt: "", //explaining what to extract
  }
  ```
* click, fill, type, press, scroll: as the name suggests, layout is as follows:

  ```json
  {
      name: "click" | "fill" | "type" | "press" | "scroll", //name of the instruction
      prompt: "", //explaining what to click, fill, type, press, scroll,
  }
  ```
