import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

interface Props {
  content: string
  className?: string
}

export default function MarkdownViewer({ content, className = '' }: Props) {
  return (
    <div
      className={`prose prose-invert prose-sm max-w-none
        prose-headings:text-gray-200 prose-p:text-gray-300 prose-a:text-accent-cyan
        prose-strong:text-gray-200 prose-code:text-accent-cyan prose-code:bg-surface-2
        prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
        prose-pre:bg-surface-0 prose-pre:border prose-pre:border-gray-800
        prose-li:text-gray-300 prose-blockquote:border-accent-cyan/30 prose-blockquote:text-gray-400
        prose-table:text-gray-300 prose-th:text-gray-200
        ${className}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
