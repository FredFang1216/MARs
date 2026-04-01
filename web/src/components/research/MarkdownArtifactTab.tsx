import MarkdownViewer from '../shared/MarkdownViewer'
import EmptyState from '../shared/EmptyState'

interface Props {
  title: string
  content: string | null
}

export default function MarkdownArtifactTab({ title, content }: Props) {
  if (!content) {
    return (
      <EmptyState
        title={`No ${title.toLowerCase()} available`}
        description={`${title} will be generated during the research process.`}
      />
    )
  }

  return <MarkdownViewer content={content} />
}
