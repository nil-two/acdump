#!/usr/bin/env node
"use strict";

const fs         = require("fs");
const getopts    = require("getopts");
const jsonschema = require("jsonschema");
const yaml       = require("js-yaml");

class AutoCompleterDumper {
    static get supportedShells() {
        return ["bash"]
    }

    static get configSchema() {
        return {
            type: "object",
            required: ["name"],
            properties: {
                "name": {
                    type: "string",
                    minLength: "1",
                },
                "use_doubledash": {
                    type: "boolean",
                },
                "opts": {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            "short": {
                                type: "array",
                                items: {type: "string"},
                            },
                            "description": {
                                type: "string",
                            },
                            "value": {
                                type: "object",
                                properties: {
                                    "name": {
                                        type: "string",
                                    },
                                    "comp": {
                                        oneOf: [
                                            {
                                                type: "object",
                                                required: ["builtin"],
                                                properties: {
                                                    "builtin": {
                                                        type: "string",
                                                        enum: ["files", "directories"],
                                                    },
                                                },
                                            },
                                            {
                                                type: "object",
                                                required: ["cmd"],
                                                properties: {
                                                    "cmd": {
                                                        type: "array",
                                                        items: {type: "string"},
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
                "args": {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            "index": {
                                type: "number",
                                minimum: "1",
                            },
                            "name": {
                                type: "string",
                            },
                            "comp": {
                                oneOf: [
                                    {
                                        type: "object",
                                        required: ["builtin"],
                                        properties: {
                                            "builtin": {
                                                type: "string",
                                                enum: ["files", "directories"],
                                            },
                                        },
                                    },
                                    {
                                        type: "object",
                                        required: ["cmd"],
                                        properties: {
                                            "cmd": {
                                                type: "array",
                                                items: {type: "string"},
                                            },
                                        },
                                    },
                                ],
                            },
                            "skip_if": {
                                type: "object",
                                properties: {
                                    "has_opt_any": {
                                        type: "array",
                                        items: {type: "string"},
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };
    }

    static shEscape(s) {
        return "'" + s.toString().replace(/'/g, `'"'"'`) + "'";
    }

    static shEscapeInQuote(s) {
        return this.shEscape(s).replace(/'/g, `'"'"'`);
    }

    static dumpBashScript(config) {
        const name           = config["name"];
        const useDoubledash  = config["use_doubledash"] || false;
        const shortOptPrefix = config["short_opt_prefix"] || "-";
        const hasShortOpts   = "opts" in config && config["opts"].some(o => "short" in o) >= 1;
        const hasArgs        = "args" in config && config["args"].length >= 1;

        const shortOpts = hasShortOpts ? config["opts"].filter(o => "short" in o) : [];
        const args      = hasArgs ? config["args"] : [];

        const maxArgIndex = args.filter(a => "index" in a && a["index"] !== "all").map(a => a["index"]).reduce((a,b) => a>b?a:b, 0);

        const a = [];
        a.push(`_${name}() {`);
        a.push(`  local cur=\${COMP_WORDS[$COMP_CWORD]}`);
        a.push(`  local prev=\${COMP_WORDS[$COMP_CWORD-1]}`);
        a.push(``);
        a.push(`  local use_doubledash=${useDoubledash}`);
        a.push(`  local has_short_opts=${hasShortOpts}`);
        a.push(`  local has_arg=true`);
        a.push(`  local short_opt_prefix=-`);
        a.push(``);
        a.push(`  declare -A short_opts_requires_value`);
        for (let opt of shortOpts) {
            for (let short of opt["short"]) {
                a.push(`  short_opts_requires_value[${this.shEscape(short)}]=${"value" in opt}`);
            }
        }
        a.push(``);
        a.push(`  declare -A short_opts_used`);
        for (let opt of shortOpts) {
            for (let short of opt["short"]) {
                a.push(`  short_opts_used[${this.shEscape(short)}]=false`);
            }
        }
        a.push(``);
        a.push(`  declare -A args_required`);
        for (let arg of args) {
            a.push(`  args_required[${this.shEscape(arg["index"] || "all")},${this.shEscape(arg["name"])}]=true`);
        }
        a.push(``);
        a.push(`  local word_i arg_i found keys key lines`);
        a.push(``);
        a.push(`  local opts_finished`);
        a.push(`  local opts_last_word_i`);
        a.push(`  if $has_short_opts; then`);
        a.push(`    opts_finished=false`);
        a.push(`    opts_last_word_i=0`);
        a.push(`    for (( word_i = 1; word_i <= COMP_CWORD - 1; word_i++ )); do`);
        a.push(`      opts_last_word_i=$word_i`);
        a.push(``);
        a.push(`      if $use_doubledash && [[ \${COMP_WORDS[$word_i]} = -- ]]; then`);
        a.push(`        opts_finished=true`);
        a.push(`        break`);
        a.push(`      elif [[ \${COMP_WORDS[$word_i]} != "$short_opt_prefix"* ]]; then`);
        a.push(`        opts_finished=true`);
        a.push(`        (( opts_last_word_i-- ))`);
        a.push(`        break`);
        a.push(`      fi`);
        a.push(``);
        a.push(`      case \${COMP_WORDS[$word_i]} in`);
        for (let opt of shortOpts) {
            for (let short of opt["short"]) {
                a.push(`        ${this.shEscape(short)})`);
                a.push(`          short_opts_used[${this.shEscape(short)}]=true`);
                a.push(`          ;;`);
            }
        }
        a.push(`      esac`);
        a.push(``);
        a.push(`      if \${short_opts_requires_value[\${COMP_WORDS[$word_i]}]-false}; then`);
        a.push(`        (( word_i++ ))`);
        a.push(`      fi`);
        a.push(`    done`);
        a.push(`  else`);
        a.push(`    opts_finished=true`);
        a.push(`    opts_last_word_i=0`);
        a.push(`  fi`);
        for (let arg of args) {
            if ("skip_if" in arg && "has_opt_any" in arg["skip_if"]) {
                for (let short of arg["skip_if"]["has_opt_any"]) {
                    a.push(`  if \${short_opts_used[${this.shEscape(short)}]}; then`);
                    a.push(`    args_required[${this.shEscape(arg["index"] || "all")},${this.shEscape(arg["name"])}]=false`);
                    a.push(`  fi`);
                }
            }
        }
        a.push(``);
        a.push(`  local arg_index=0`);
        a.push(`  for (( word_i = opts_last_word_i + 1; word_i <= COMP_CWORD; word_i++ )); do`);
        a.push(`    found=false`);
        a.push(`    for (( arg_i = arg_index + 1; arg_i <= ${maxArgIndex}; arg_i++ )); do`);
        a.push(`      mapfile -t keys < <(printf "%s\\n" "\${!args_required[@]}" | awk -v i=$arg_i, 'index($0, i) == 1')`);
        a.push(`      for key in "\${keys[@]}"; do`);
        a.push(`        if \${args_required[$key]}; then`);
        a.push(`          found=true`);
        a.push(`          (( arg_index = \${key%,*} ))`);
        a.push(`          break 2`);
        a.push(`        fi`);
        a.push(`      done`);
        a.push(`    done`);
        a.push(`    if ! $found; then`);
        a.push(`      arg_index=all`);
        a.push(`      break`);
        a.push(`    fi`);
        a.push(`  done`);
        a.push(``);
        a.push(`  local mode`);
        a.push(`  if ! $has_short_opts; then`);
        a.push(`    mode=arg`);
        a.push(`  elif $opts_finished; then`);
        a.push(`    mode=arg`);
        a.push(`  elif (( COMP_CWORD >= 2 )) && \${short_opts_requires_value[$prev]-false}; then`);
        a.push(`    mode=opt_arg`);
        a.push(`  elif [[ $cur = "$short_opt_prefix"* ]]; then`);
        a.push(`    mode=opt`);
        a.push(`  else`);
        a.push(`    mode=arg`);
        a.push(`  fi`);
        a.push(``);
        a.push(`  case $mode in`);
        if (hasShortOpts) {
            const shorts = shortOpts.map(o => o["short"]).reduce((a,b) => a.concat(b), []);
            a.push(`    opt)`);
            a.push(`      lines=$(compgen -W '${shorts.map(s => this.shEscapeInQuote(s)).join(" ")}' -- "$cur") && while read -r line; do COMPREPLY+=( "$(printf "%q\n" "$line")" ); done <<< "$lines"`);
            a.push(`      ;;`);
            a.push(`    opt_arg)`);
            a.push(`      case $prev in`);
            for (let opt of shortOpts) {
                if ("value" in opt && "comp" in opt["value"]) {
                    for (let short of opt["short"]) {
                        const comp = opt["value"]["comp"];
                        a.push(`        ${this.shEscape(short)})`);
                        if ("builtin" in comp) {
                            switch (comp["builtin"]) {
                                case "files":
                                    a.push(`          lines=$(compgen -f -- "$cur") && while read -r line; do COMPREPLY+=( "$line" ); done <<< "$lines"`);
                                    a.push(`          compopt -o filenames`);
                                    break;
                                case "directories":
                                    a.push(`          lines=$(compgen -d -- "$cur") && while read -r line; do COMPREPLY+=( "$line" ); done <<< "$lines"`);
                                    a.push(`          compopt -o filenames`);
                                    break;
                            }
                        } else if ("cmd" in comp) {
                            a.push(`          lines=$(compgen -W '$(${comp["cmd"].map(s => this.shEscapeInQuote(s)).join(" ")})' -- "$cur") && while read -r line; do COMPREPLY+=( "$line" ); done <<< "$lines"`);
                        }
                        a.push(`          ;;`);
                    }
                }
            }
            a.push(`      esac`);
            a.push(`      ;;`);
        }
        if (hasArgs) {
            a.push(`    arg)`);
            a.push(`      case $arg_index in`);
            for (let arg of args) {
                if ("comp" in arg) {
                    const comp = arg["comp"];
                    a.push(`        ${this.shEscape(arg["index"] || "all")})`);
                    if ("builtin" in comp) {
                        switch (comp["builtin"]) {
                            case "files":
                                a.push(`          lines=$(compgen -f -- "$cur") && while read -r line; do COMPREPLY+=( "$line" ); done <<< "$lines"`);
                                a.push(`          compopt -o filenames`);
                                break;
                            case "directories":
                                a.push(`          lines=$(compgen -d -- "$cur") && while read -r line; do COMPREPLY+=( "$line" ); done <<< "$lines"`);
                                a.push(`          compopt -o filenames`);
                                break;
                        }
                    } else if ("cmd" in comp) {
                        a.push(`          lines=$(compgen -W '$(${comp["cmd"].map(s => this.shEscapeInQuote(s)).join(" ")})' -- "$cur") && while read -r line; do COMPREPLY+=( "$line" ); done <<< "$lines"`);
                    }
                    a.push(`          ;;`);
                }
            }
            a.push(`      esac`);
            a.push(`      ;;`);
        }
        a.push(`  esac`);
        a.push(`}`);
        a.push(`complete -F _${name} ${name}`);
        return a.join("\n");
    }

    static dumpScript(config, targetShell) {
        if (!this.supportedShells.some(shell => shell === targetShell)) {
            throw new Error(`'${targetShell}' doesn't supported yet`);
        }

        const validatorResult = jsonschema.validate(config, this.configSchema);
        if (validatorResult.errors.length !== 0) {
            throw new Error("cannot accept source\n" + validatorResult.errors.map(e => e.toString()).join("\n"));
        }

        switch (targetShell) {
            case "bash":
                return this.dumpBashScript(config);
            default:
                return "";
        }
    }
}

class Command {
    static get cmdName() {
        return "acdump";
    }

    static get usage() {
        return `
        usage: ${this.cmdName} [option(s)] <source-file>
        dump an autocompleter for shells.
          
        options:
          -o. --output=OUTPUT   output file
          -s. --shell=SHELL     target shell (default: bash)
              --help            print usage
        `.replace(/^ {8}/gm, "").trim();
    }

    static execute(argv) {
        let unknownOption = null;
        const options = getopts(argv, {
            string: [
                "output",
                "shell",
            ],
            boolean: [
                "help",
            ],
            default: {
                output: "",
                shell: "bash",
                help: false,
            },
            alias: {
                output: "o",
                shell:  "s",
            },
            unknown: function(option) {
                if (unknownOption === null) {
                    unknownOption = option;
                }
                return false;
            }
        });
        if (unknownOption !== null) {
            console.error("%s", `${this.cmdName}: unrecognized option: '${unknownOption}'`);
            console.error("%s", `Try '${this.cmdName} --help' for more information.`);
            process.exit(1);
        }
        if (options.help) {
            console.log("%s", this.usage);
            process.exit(0);
        }
        if (!AutoCompleterDumper.supportedShells.some(shell => shell === options.shell)) {
            console.error("%s", `${this.cmdName}: '${options.shell}' doesn't supported yet`);
            process.exit(1);
        }
        if (options._.length === 0) {
            console.error("%s", `${this.cmdName}: no input source-file`);
            process.exit(1);
        }

        try {
            const sourceFile = options._[0];
            const rawConfig  = fs.readFileSync(sourceFile, "utf8");
            const config     = yaml.safeLoad(rawConfig);

            const script = AutoCompleterDumper.dumpScript(config, options.shell);
            if (options.output === "") {
                console.log("%s", script);
            } else {
                fs.writeFileSync(options.output, script + "\n");
            }
        } catch (err) {
            console.error("%s", `${this.cmdName}: ${err.name}: ${err.message}`);
            process.exit(1);
        }
    }
}

Command.execute(process.argv.slice(2));
