# Attribution and third-party notices

## Project provenance

This repository, <https://github.com/EpocheDrift/a-psychos-gd-tool>, is an
Agent-enabled downstream of Blake Shao's original project:

<https://github.com/blakeshao/a-psychos-gd-tool>

The original project was created by Blake Shao and is distributed under the
MIT License. Its copyright notice is preserved in [LICENSE](LICENSE). This
downstream retains the human node-based WebGPU editor and includes additional
work such as portable persistence, the local Agent/MCP command and transport
layers, the shared 5199 workbench, safety and verification infrastructure,
bilingual documentation, and the alpha graphic-design collaboration Skill.

The original upstream hosted demo at
<https://a-psychos-gd-tool.vercel.app/> is operated from the upstream project
and does not represent or include all features in this downstream repository.
This downstream currently makes no claim of a public hosted deployment.

References to the upstream project, Codex, Claude Code, Chrome, Edge, Safari,
Adobe Illustrator, or other products describe origin, interoperability, or
planned formats. They do not imply endorsement of this downstream or support
for its additions by the original author or those product vendors.

Unless a file says otherwise, modifications distributed in this repository are
provided under the same [MIT License](LICENSE). Git history records individual
contributions; this notice does not replace or reassign their authorship.

## Fonts and fixtures

JetBrains Mono files under [`public/fonts/`](public/fonts/) are distributed
under the [SIL Open Font License 1.1](public/fonts/OFL.txt).

The bundled poster fixture and [`public/factory-image.jpg`](public/factory-image.jpg)
are inherited unchanged from the upstream repository, where they are
distributed with the project under its MIT License. This records repository
provenance; it is not a claim that the image is a separately licensed stock
asset.

Evaluation fixtures that carry their own license remain governed by the notice
next to those files, including
[`evals/collaborate-on-graphic-design/v0.1-alpha/fixtures/LICENSE.txt`](evals/collaborate-on-graphic-design/v0.1-alpha/fixtures/LICENSE.txt).

## Optional model artifacts

RMBG-1.4 model artifacts are not bundled into this Git repository. If a user
chooses the optional Remove Background workflow, the application presents a
separate license disclosure before the first pinned, integrity-checked model
download. Those model artifacts retain their own terms and are not relicensed
under this repository's MIT License. Review the model publisher's current
[RMBG-1.4 model card and license](https://huggingface.co/briaai/RMBG-1.4)
before use, especially for a commercial context.

## Dependencies

Third-party packages installed from `package-lock.json` retain their respective
licenses and notices. The MIT License for this repository does not replace the
terms attached to those dependencies.
