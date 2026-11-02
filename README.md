# @odeloic/lgtm

A local agentic review tool for GitHub pull requests and GitLab merge requests. It uses your Cursor agent to review a change against your project's rules, then lets you go through the findings in a local web interface.

## Requirements

- Node.js 20 or later
- The [Cursor agent CLI](https://cursor.com/cli), logged in with `agent login`
- A GitHub or GitLab token, from `gh` or `glab`, an environment variable (`GITHUB_TOKEN`, `GH_TOKEN` or `GITLAB_TOKEN`), or the `--token` flag

## Quick start

```sh
npm install -g @odeloic/lgtm

lgtm setup            # check the Cursor agent and choose your models
lgtm init             # inside a repository: propose rules and connect the remote
lgtm review --mr 123  # review a pull or merge request
```

## Commands

| Command | Description |
| --- | --- |
| `lgtm setup` | Check the Cursor agent and choose the review and verify models. |
| `lgtm init` | Set up the current repository: rules, review voice and remote connection. |
| `lgtm connect` | Connect the repository to its GitHub or GitLab remote. |
| `lgtm review --mr <id>` | Review a pull or merge request. |
| `lgtm open <mr>` | Reopen the latest saved review of a pull or merge request. |

Run `lgtm --help` to see every flag.

## Files

- `.lgtm/` in your repository holds project settings and `rules.yaml`.
- `~/.lgtm/` holds your user settings, including your models and review voice.

## License

MIT
