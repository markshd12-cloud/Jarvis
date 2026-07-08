# Instruções do Projeto

## Idioma

Sempre responda em Português do Brasil em todas as tarefas e interações.

## Boas Práticas de Desenvolvimento

Siga as boas práticas de desenvolvimento recomendadas para as tecnologias utilizadas no projeto. Isso inclui, mas não se limita a:

- Manter o código limpo e organizado
- Escrever comentários claros e úteis
- Evitar código duplicado
- Seguir os padrões de nomenclatura e estrutura do projeto
- Testar o código adequadamente antes de entregá-lo
- Reutilizar componentes e funções sempre que possível
- Manter a consistência em todo o códigobase
- Seguir as diretrizes de segurança e privacidade aplicáveis

## Decisão do Projeto

Esta seção define padrões arquiteturais e de código adotados no projeto. Esses padrões **devem ser seguidos em todas as implementações**. Qualquer alteração ou desvio de um padrão aqui descrito requer aviso prévio ao usuário com justificativa técnica clara antes de ser aplicado.

### Estrutura de Pages

Toda page deve seguir a hierarquia de elementos abaixo:

```tsx
<main>
  <section>
    <div className="sectionbox {classes-específicas}">
      {/* conteúdo da page */}
    </div>
  </section>
</main>
```

Cada camada tem responsabilidade própria, definida no `globals.css`:

| Elemento         | Responsabilidade                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `main`           | Layout vertical da página (`flex-col`, `min-h-full`, largura full)                                    |
| `section`        | Centralização horizontal e espaçamento lateral (`grid`, `justify-items-center`, `px-4`, `min-h-full`) |
| `div.sectionbox` | Largura máxima do conteúdo (`max-w-285`) e flex container interno                                     |

Classes adicionais de layout (ex.: `flex-col`, `items-center`, `min-h-screen`) devem ser aplicadas diretamente na `div.sectionbox`, nunca nos elementos estruturais `main` ou `section`.

**Exemplo correto:**

```tsx
export default function LoginPage() {
  return (
    <main>
      <section>
        <div className="sectionbox min-h-screen flex-col items-center justify-center">
          <Login />
        </div>
      </section>
    </main>
  )
}
```
